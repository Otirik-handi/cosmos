import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { setTimeout as delayTimer } from "node:timers/promises";
import { DEFAULT_DRAIN_DEADLINE_MS, DEFAULT_LANES, MAX_DRAIN_DEADLINE_MS, MAX_DRAIN_HISTORY, cloneDrain, isTerminalDrain, normalizeDeadline, validateIdempotencyKey, validateReason } from "./drain.js";
import { defaultComponents, failureComponent, failureSnapshot, metricLabel, publicFailureMessage, sanitizeComponent, sanitizeComponents, toFailure } from "./health.js";
import { WorkerAdminRequestError } from "./types.js";
import type { DrainRecord, LaneState } from "./drain.js";
import type { ComponentHealth, ComponentStatus, CreateDrainCommand, DrainDecision, FailureSnapshot, WorkerActiveAttemptSummary, WorkerAdminLaneConfig, WorkerAdminOptions, WorkerCapabilitySnapshot, WorkerDrainSnapshot, WorkerLaneStatus, WorkerLivenessSnapshot, WorkerManifestEvidence, WorkerReadinessSnapshot, WorkerStatusSnapshot } from "./types.js";

export class WorkerAdminService {
    private readonly now: () => Date;
    private readonly options: WorkerAdminOptions;
    private readonly processStartedAt: string;
    private readonly lanes = new Map<string, LaneState>();
    private readonly drains = new Map<string, DrainRecord>();
    private readonly recentErrors: FailureSnapshot[] = [];
    private readonly activeAttempts = new Map<string, WorkerActiveAttemptSummary>();
    private readonly drainEvents = new EventEmitter();
    private ready = false;
    private acceptingWork = false;
    private draining = false;
    private stopped = false;
    private registeredAt: string | null = null;
    private lastHeartbeatAt: string | null = null;
    private activePolls = 0;
    private currentDrain: DrainRecord | null = null;
    private healthDegraded = false;
    private degraded = false;

    constructor(options: WorkerAdminOptions) {
        this.options = options;
        this.now = options.now ?? (() => new Date());
        this.processStartedAt = options.processStartedAt ?? this.now().toISOString();
        for (const lane of options.lanes ?? DEFAULT_LANES) {
            if (this.lanes.has(lane.lane)) {
                throw new Error(`Duplicate Worker Admin lane: ${lane.lane}`);
            }
            const configuredSlots = lane.configuredSlots ?? 1;
            if (!Number.isSafeInteger(configuredSlots) || configuredSlots <= 0) {
                throw new Error(`Worker Admin lane ${lane.lane} must have positive slots.`);
            }
            this.lanes.set(lane.lane, {
                lane: lane.lane,
                enabled: lane.enabled !== false,
                configuredSlots,
                acceptingSlots: 0,
                activeSlots: 0,
                idleSlots: configuredSlots,
                lastClaimAt: null,
                lastPollAt: null,
                lastError: null,
                activePolls: 0,
                pollCount: 0,
                claimCount: 0,
            });
        }
    }

    markReady(): void {
        if (this.stopped) return;
        this.ready = true;
        this.acceptingWork = !this.draining;
        this.registeredAt ??= this.now().toISOString();
        this.lastHeartbeatAt = this.now().toISOString();
    }

    markHeartbeat(): void {
        if (!this.stopped) this.lastHeartbeatAt = this.now().toISOString();
    }

    markStopped(): void {
        this.stopped = true;
        this.ready = false;
        this.acceptingWork = false;
        this.draining = false;
    }

    canAcceptWork(): boolean {
        return this.ready
            && this.acceptingWork
            && !this.draining
            && !this.stopped
            && [...this.lanes.values()].some((lane) => lane.enabled);
    }

    beginPoll(laneName: string): boolean {
        if (!this.canAcceptWork()) return false;
        const lane = this.lanes.get(laneName);
        if (!lane || !lane.enabled) return false;
        lane.activePolls += 1;
        lane.pollCount += 1;
        lane.activeSlots = Math.min(lane.configuredSlots, lane.activePolls);
        lane.acceptingSlots = Math.max(0, lane.configuredSlots - lane.activeSlots);
        lane.idleSlots = Math.max(0, lane.configuredSlots - lane.activeSlots);
        lane.lastPollAt = this.now().toISOString();
        this.activePolls += 1;
        return true;
    }

    endPoll(laneName: string, error?: unknown): void {
        const lane = this.lanes.get(laneName);
        if (!lane) return;
        lane.activePolls = Math.max(0, lane.activePolls - 1);
        lane.activeSlots = Math.min(lane.configuredSlots, lane.activePolls);
        lane.acceptingSlots = Math.max(0, lane.configuredSlots - lane.activeSlots);
        lane.idleSlots = Math.max(0, lane.configuredSlots - lane.activeSlots);
        this.activePolls = Math.max(0, this.activePolls - 1);
        if (error !== undefined) {
            const failure = toFailure(error, this.now());
            lane.lastError = failure;
            this.recentErrors.unshift(failure);
            this.recentErrors.splice(10);
        } else {
            // A completed poll is the explicit recovery observation for this lane.
            lane.lastError = null;
        }
        this.refreshDegradedState();
    }

    recordClaim(laneName: string): void {
        const lane = this.lanes.get(laneName);
        if (lane) {
            lane.lastClaimAt = this.now().toISOString();
            lane.claimCount += 1;
        }
    }

    registerAttempt(attempt: WorkerActiveAttemptSummary): void {
        if (!this.stopped) this.activeAttempts.set(attempt.attemptId, { ...attempt });
    }

    finishAttempt(attemptId: string): void {
        this.activeAttempts.delete(attemptId);
    }

    private refreshDegradedState(): void {
        this.degraded = this.healthDegraded
            || ![...this.lanes.values()].some((lane) => lane.enabled)
            || [...this.lanes.values()].some((lane) => lane.lastError !== null);
    }

    async readiness(): Promise<WorkerReadinessSnapshot> {
        const checkedAt = this.now().toISOString();
        const defaults = defaultComponents(checkedAt, this.ready);
        let components = defaults;
        try {
            const supplied = await this.options.health?.();
            if (supplied) {
                components = {
                    ...defaults,
                    ...sanitizeComponents(supplied),
                };
            }
        } catch (error) {
            this.healthDegraded = true;
            const failure = toFailure(error, this.now());
            this.recentErrors.unshift(failure);
            this.recentErrors.splice(10);
            components = {
                migration: failureComponent(failure, checkedAt),
                taskStore: failureComponent(failure, checkedAt),
                definitionCatalog: failureComponent(failure, checkedAt),
                actionRegistry: failureComponent(failure, checkedAt),
                connectorRegistry: failureComponent(failure, checkedAt),
                valueStore: failureComponent(failure, checkedAt),
            };
        }
        const required = [
            components.migration,
            components.definitionCatalog,
            components.actionRegistry,
            components.connectorRegistry,
            components.valueStore,
            ...(components.taskStore ? [components.taskStore] : []),
        ];
        const laneEnabled = [...this.lanes.values()].some((lane) => lane.enabled);
        const componentsReady = required.every((component) => component.status === "ready" || component.status === "disabled");
        this.healthDegraded = !componentsReady;
        this.refreshDegradedState();
        const ready = this.ready
            && !this.stopped
            && !this.draining
            && !this.degraded
            && this.acceptingWork
            && laneEnabled
            && componentsReady;
        return {
            ready,
            workerId: this.options.workerId,
            instanceId: this.options.instanceId,
            mode: this.options.mode ?? "direct",
            acceptingWork: this.acceptingWork,
            draining: this.draining,
            components,
            checkedAt,
        };
    }

    liveness(): WorkerLivenessSnapshot {
        return {
            status: "alive",
            service: "cosmos-worker",
            workerId: this.options.workerId,
            instanceId: this.options.instanceId,
            version: this.options.version,
            processStartedAt: this.processStartedAt,
            timestamp: this.now().toISOString(),
        };
    }

    status(): WorkerStatusSnapshot {
        const status = this.stopped
            ? "stopped"
            : this.draining
                ? "draining"
                : this.degraded
                    ? "degraded"
                    : this.ready
                        ? "ready"
                        : "starting";
        return {
            workerId: this.options.workerId,
            instanceId: this.options.instanceId,
            registrationGeneration: null,
            version: this.options.version,
            mode: this.options.mode ?? "direct",
            status,
            processStartedAt: this.processStartedAt,
            registeredAt: this.registeredAt,
            lastHeartbeatAt: this.lastHeartbeatAt,
            lanes: [...this.lanes.values()].map(({ activePolls: _activePolls, pollCount: _pollCount, claimCount: _claimCount, ...lane }) => ({ ...lane })),
            activeAttempts: [...this.activeAttempts.values()].map((attempt) => ({ ...attempt })),
            activeAttemptCount: this.activeAttempts.size,
            activePollCount: this.activePolls,
            recentErrors: [...this.recentErrors],
            drain: this.currentDrain?.snapshot ?? null,
            timestamp: this.now().toISOString(),
        };
    }

    capabilities(): WorkerCapabilitySnapshot {
        return {
            workerId: this.options.workerId,
            instanceId: this.options.instanceId,
            version: this.options.version,
            mode: this.options.mode ?? "direct",
            evidenceVersion: 1,
            evidenceAuthority: "local_executable",
            lanes: [...this.lanes.values()].filter((lane) => lane.enabled).map((lane) => lane.lane),
            genericCapabilities: [...(this.options.genericCapabilities ?? [])],
            workflowEvidence: [...(this.options.workflowEvidence ?? [])].map((item) => ({
                ref: item.ref,
                manifestHash: { ...item.manifestHash },
            })),
            actionEvidence: [...(this.options.actionEvidence ?? [])].map((item) => ({
                ref: item.ref,
                manifestHash: { ...item.manifestHash },
                executionPlacements: [...item.executionPlacements],
            })),
            connectorEvidence: [...(this.options.connectorEvidence ?? [])].map((item) => ({
                ref: item.ref,
                manifestHash: { ...item.manifestHash },
            })),
            limits: {
                maxConcurrency: this.options.limits?.maxConcurrency ?? 1,
                maxInlineValueBytes: this.options.limits?.maxInlineValueBytes ?? 1_048_576,
                maxJobRuntimeMs: this.options.limits?.maxJobRuntimeMs ?? null,
            },
            generatedAt: this.now().toISOString(),
        };
    }

    metrics(): string {
        const lines = [
            `cosmos_worker_ready ${this.ready && !this.stopped && !this.degraded ? 1 : 0}`,
            `cosmos_worker_accepting_work ${this.canAcceptWork() ? 1 : 0}`,
            `cosmos_worker_active_attempts ${this.activeAttempts.size}`,
            `cosmos_worker_active_polls ${this.activePolls}`,
            `cosmos_worker_drain_total{status="${metricLabel(this.currentDrain?.snapshot.status ?? "none")}"} ${this.currentDrain ? 1 : 0}`,
            `cosmos_worker_lease_renew_total{result="unknown"} 0`,
            `cosmos_worker_gateway_request_total{operation="unknown",result="unknown"} 0`,
        ];
        const attemptsByLaneAndAction = new Map<string, number>();
        for (const attempt of this.activeAttempts.values()) {
            const key = `${metricLabel(attempt.lane)}\u0000${metricLabel(attempt.actionRef)}`;
            attemptsByLaneAndAction.set(key, (attemptsByLaneAndAction.get(key) ?? 0) + 1);
        }
        for (const lane of this.lanes.values()) {
            const label = metricLabel(lane.lane);
            const laneAttempts = [...attemptsByLaneAndAction.entries()]
                .filter(([key]) => key.startsWith(`${label}\u0000`));
            if (laneAttempts.length === 0) {
                lines.push(`cosmos_worker_active_attempts{lane="${label}",action_ref="unknown"} 0`);
            } else {
                for (const [key, count] of laneAttempts) {
                    const actionRef = key.slice(label.length + 1);
                    lines.push(`cosmos_worker_active_attempts{lane="${label}",action_ref="${actionRef}"} ${count}`);
                }
            }
            lines.push(`cosmos_worker_active_polls{lane="${label}"} ${lane.activeSlots}`);
            lines.push(`cosmos_worker_claim_total{lane="${label}",result="claimed"} ${lane.claimCount}`);
            lines.push(`cosmos_worker_poll_duration_seconds{lane="${label}"} 0`);
            lines.push(`cosmos_worker_poll_total{lane="${label}"} ${lane.pollCount}`);
        }
        lines.push("cosmos_worker_attempt_total{action_ref=\"unknown\",status=\"unknown\"} 0");
        lines.push("cosmos_worker_attempt_duration_seconds{action_ref=\"unknown\",status=\"unknown\"} 0");
        return `${lines.join("\n")}\n`;
    }

    listDrains(): readonly WorkerDrainSnapshot[] {
        return [...this.drains.values()]
            .sort((left, right) => right.snapshot.acceptedAt.localeCompare(left.snapshot.acceptedAt))
            .map((record) => ({
                ...record.snapshot,
                activeAttemptIds: [...record.snapshot.activeAttemptIds],
                error: record.snapshot.error ? { ...record.snapshot.error } : null,
            }));
    }

    getDrain(id: string): WorkerDrainSnapshot | null {
        const record = this.drains.get(id);
        if (!record) return null;
        return {
            ...record.snapshot,
            activeAttemptIds: [...record.snapshot.activeAttemptIds],
            error: record.snapshot.error ? { ...record.snapshot.error } : null,
        };
    }

    async waitForDrain(id: string): Promise<WorkerDrainSnapshot> {
        const current = this.getDrain(id);
        if (!current) {
            throw new WorkerAdminRequestError("not_found", "Worker drain not found.", 404);
        }
        if (!isTerminalDrain(current.status)) {
            await new Promise<void>((resolve) => {
                const eventName = `drain:${id}`;
                const listener = (): void => {
                    this.drainEvents.off(eventName, listener);
                    resolve();
                };
                this.drainEvents.once(eventName, listener);
                const latest = this.getDrain(id);
                if (latest && isTerminalDrain(latest.status)) {
                    this.drainEvents.off(eventName, listener);
                    resolve();
                }
            });
        }
        const settled = this.getDrain(id);
        if (!settled) {
            throw new WorkerAdminRequestError("not_found", "Worker drain not found.", 404);
        }
        return settled;
    }

    requestDrain(idempotencyKey: string, command: CreateDrainCommand): DrainDecision {
        const key = validateIdempotencyKey(idempotencyKey);
        const reason = validateReason(command.reason);
        const deadlineMs = normalizeDeadline(command.deadlineMs);
        if (command.exitAfterDrain !== undefined && command.exitAfterDrain !== true) {
            throw new WorkerAdminRequestError(
                "invalid_request",
                "exitAfterDrain must be true when provided.",
                400,
            );
        }
        const existing = this.drains.get(key);
        if (existing) {
            if (existing.reason !== reason || existing.deadlineMs !== deadlineMs) {
                throw new WorkerAdminRequestError(
                    "conflict",
                    "Idempotency-Key was already used with a different drain command.",
                    409,
                );
            }
            return {
                snapshot: cloneDrain(existing.snapshot),
                statusCode: isTerminalDrain(existing.snapshot.status) ? 200 : 202,
            };
        }
        if (this.stopped) {
            throw new WorkerAdminRequestError("already_stopped", "Worker has already stopped.", 409);
        }
        if (this.currentDrain && !isTerminalDrain(this.currentDrain.snapshot.status)) {
            throw new WorkerAdminRequestError(
                "drain_in_progress",
                "A different Worker drain is already in progress.",
                409,
                true,
            );
        }
        const acceptedAt = this.now().toISOString();
        const deadlineAt = deadlineMs === null
            ? null
            : new Date(this.now().getTime() + deadlineMs).toISOString();
        const snapshot: WorkerDrainSnapshot = {
            id: randomUUID(),
            workerId: this.options.workerId,
            instanceId: this.options.instanceId,
            idempotencyKey: key,
            status: "accepted",
            reason,
            activeAttemptIds: [...this.activeAttempts.keys()],
            activePollCount: this.activePolls,
            acceptedAt,
            deadlineAt,
            finishedAt: null,
            exitAfterDrain: true,
            resourcesClosed: false,
            error: null,
        };
        const record: DrainRecord = { snapshot, reason, deadlineMs };
        this.drains.set(key, record);
        this.drains.set(snapshot.id, record);
        this.currentDrain = record;
        this.draining = true;
        const acceptedSnapshot = cloneDrain(snapshot);
        this.acceptingWork = false;
        snapshot.status = "draining";
        void this.executeDrain(record);
        this.trimDrainHistory();
        return { snapshot: acceptedSnapshot, statusCode: 202 };
    }

    private async executeDrain(record: DrainRecord): Promise<void> {
        const deadline = record.snapshot.deadlineAt ? Date.parse(record.snapshot.deadlineAt) : null;
        while (this.activePolls > 0 || this.activeAttempts.size > 0) {
            if (deadline !== null && this.now().getTime() >= deadline) {
                record.snapshot.status = "timed_out";
                record.snapshot.finishedAt = this.now().toISOString();
                record.snapshot.activeAttemptIds = [...this.activeAttempts.keys()];
                record.snapshot.activePollCount = this.activePolls;
                record.snapshot.error = failureSnapshot(
                    "terminal",
                    "drain_timeout",
                    "Worker drain deadline elapsed while active polls or attempts remained.",
                    false,
                    this.now(),
                );
                try {
                    await this.options.onDrainTimeout?.(cloneDrain(record.snapshot));
                } catch (error) {
                    this.recentErrors.unshift(toFailure(error, this.now()));
                    this.recentErrors.splice(10);
                }
                this.drainEvents.emit(`drain:${record.snapshot.id}`);
                return;
            }
            await delay(10);
        }
        try {
            await this.options.onDrain?.(cloneDrain(record.snapshot));
            record.snapshot.status = "succeeded";
            record.snapshot.finishedAt = this.now().toISOString();
            record.snapshot.activeAttemptIds = [];
            record.snapshot.activePollCount = 0;
            record.snapshot.resourcesClosed = true;
        } catch (error) {
            record.snapshot.status = "failed";
            record.snapshot.finishedAt = this.now().toISOString();
            record.snapshot.error = failureSnapshot(
                "terminal",
                "drain_failed",
                "Worker drain could not close its resources.",
                false,
                this.now(),
            );
            this.recentErrors.unshift(toFailure(error, this.now()));
            this.recentErrors.splice(10);
        }
        this.drainEvents.emit(`drain:${record.snapshot.id}`);
    }

    private trimDrainHistory(): void {
        const records = [...new Set(this.drains.values())]
            .sort((left, right) => right.snapshot.acceptedAt.localeCompare(left.snapshot.acceptedAt));
        for (const record of records.slice(MAX_DRAIN_HISTORY)) {
            this.drains.delete(record.snapshot.id);
            this.drains.delete(record.snapshot.idempotencyKey);
        }
    }
}

async function delay(milliseconds: number): Promise<void> {
    await delayTimer(milliseconds);
}
