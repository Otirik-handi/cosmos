import { randomUUID } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { setTimeout as delayTimer } from "node:timers/promises";

export type WorkerMode = "direct" | "gateway";
export type ComponentStatus = "ready" | "degraded" | "unavailable" | "disabled" | "unknown";

export interface FailureSnapshot {
    kind: "aborted" | "retryable" | "terminal" | "unknown";
    code: string | null;
    message: string;
    retryable: boolean;
    occurredAt?: string | null;
    detailsRef?: null;
}

export interface ComponentHealth {
    status: ComponentStatus;
    checkedAt: string;
    code?: string | null;
    message?: string | null;
}

export interface WorkerLaneStatus {
    lane: string;
    enabled: boolean;
    configuredSlots: number;
    acceptingSlots: number;
    activeSlots: number;
    idleSlots: number;
    lastClaimAt: string | null;
    lastPollAt: string | null;
    lastError: FailureSnapshot | null;
}

export interface WorkerActiveAttemptSummary {
    attemptId: string;
    jobId: string;
    runId: string;
    actionRef: string;
    lane: string;
    slot: number;
    startedAt: string;
    leaseExpiresAt: string;
    cancellationRequested: boolean;
}

export interface WorkerLivenessSnapshot {
    status: "alive";
    service: "cosmos-worker";
    workerId: string;
    instanceId: string;
    version: string;
    processStartedAt: string;
    timestamp: string;
}

export interface WorkerReadinessSnapshot {
    ready: boolean;
    workerId: string;
    instanceId: string;
    mode: WorkerMode;
    acceptingWork: boolean;
    draining: boolean;
    components: {
        migration: ComponentHealth;
        taskStore?: ComponentHealth;
        gatewaySession?: ComponentHealth;
        definitionCatalog: ComponentHealth;
        actionRegistry: ComponentHealth;
        connectorRegistry: ComponentHealth;
        valueStore: ComponentHealth;
    };
    checkedAt: string;
}

export interface WorkerStatusSnapshot {
    workerId: string;
    instanceId: string;
    registrationGeneration: number | null;
    version: string;
    mode: WorkerMode;
    status: "starting" | "ready" | "draining" | "stopped" | "degraded";
    processStartedAt: string;
    registeredAt: string | null;
    lastHeartbeatAt: string | null;
    lanes: WorkerLaneStatus[];
    activeAttempts: WorkerActiveAttemptSummary[];
    /** Only explicitly registered runtime Attempts; active polls remain separate. */
    activeAttemptCount: number;
    activePollCount: number;
    recentErrors: FailureSnapshot[];
    drain: WorkerDrainSnapshot | null;
    timestamp: string;
}

export interface WorkerManifestEvidence {
    ref: string;
    manifestHash: {
        algorithm: string;
        value: string;
    };
}

export interface WorkerCapabilitySnapshot {
    workerId: string;
    instanceId: string;
    version: string;
    mode: WorkerMode;
    evidenceVersion: number;
    evidenceAuthority: "local_executable" | "catalog_admitted";
    lanes: string[];
    genericCapabilities: string[];
    workflowEvidence: WorkerManifestEvidence[];
    actionEvidence: (WorkerManifestEvidence & {
        executionPlacements: ("host" | "trusted_worker" | "remote_worker")[];
    })[];
    connectorEvidence: WorkerManifestEvidence[];
    limits: {
        maxConcurrency: number;
        maxInlineValueBytes: number;
        maxJobRuntimeMs: number | null;
    };
    generatedAt: string;
}

export interface WorkerDrainSnapshot {
    id: string;
    workerId: string;
    instanceId: string;
    idempotencyKey: string;
    status: "accepted" | "draining" | "succeeded" | "timed_out" | "failed";
    reason: string;
    activeAttemptIds: string[];
    activePollCount: number;
    acceptedAt: string;
    deadlineAt: string | null;
    finishedAt: string | null;
    exitAfterDrain: true;
    resourcesClosed: boolean;
    error: FailureSnapshot | null;
}

export interface WorkerAdminLaneConfig {
    lane: string;
    configuredSlots?: number;
    enabled?: boolean;
}

export interface WorkerAdminOptions {
    workerId: string;
    instanceId: string;
    version: string;
    mode?: WorkerMode;
    processStartedAt?: string;
    now?: () => Date;
    lanes?: readonly WorkerAdminLaneConfig[];
    health?: () => Promise<Partial<WorkerReadinessSnapshot["components"]>>;
    genericCapabilities?: readonly string[];
    workflowEvidence?: readonly WorkerManifestEvidence[];
    actionEvidence?: readonly (WorkerManifestEvidence & {
        executionPlacements: ("host" | "trusted_worker" | "remote_worker")[];
    })[];
    connectorEvidence?: readonly WorkerManifestEvidence[];
    limits?: Partial<WorkerCapabilitySnapshot["limits"]>;
    onDrain?: (snapshot: WorkerDrainSnapshot) => Promise<void>;
}

export interface CreateDrainCommand {
    reason: string;
    deadlineMs?: number | null;
    exitAfterDrain?: true;
}

export interface DrainDecision {
    snapshot: WorkerDrainSnapshot;
    statusCode: 200 | 202;
}

export class WorkerAdminRequestError extends Error {
    constructor(
        readonly code:
            | "invalid_request"
            | "unauthorized"
            | "not_found"
            | "conflict"
            | "drain_in_progress"
            | "already_stopped"
            | "payload_too_large"
            | "internal_error",
        message: string,
        readonly statusCode: 400 | 401 | 404 | 409 | 413 | 500,
        readonly retryable = false,
    ) {
        super(message);
        this.name = "WorkerAdminRequestError";
    }
}

type LaneState = WorkerLaneStatus & {
    activePolls: number;
    pollCount: number;
    claimCount: number;
};
type DrainRecord = {
    snapshot: WorkerDrainSnapshot;
    reason: string;
    deadlineMs: number | null;
};

const DEFAULT_LANES: readonly WorkerAdminLaneConfig[] = [{ lane: "direct", configuredSlots: 1 }];
const MAX_DRAIN_HISTORY = 20;
const DEFAULT_DRAIN_DEADLINE_MS = 30_000;
const MAX_DRAIN_DEADLINE_MS = 24 * 60 * 60 * 1_000;
const MAX_REASON_LENGTH = 200;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

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

export interface WorkerAdminServerOptions extends WorkerAdminOptions {
    host?: string;
    port?: number;
    authorize?: (request: IncomingMessage) => boolean | Promise<boolean>;
    maxBodyBytes?: number;
}

export interface WorkerAdminServer {
    readonly service: WorkerAdminService;
    readonly server: HttpServer;
    start(): Promise<void>;
    close(): Promise<void>;
}

export function createWorkerAdminServer(options: WorkerAdminServerOptions): WorkerAdminServer {
    const host = options.host ?? "127.0.0.1";
    if (!isLoopbackOrInternalHost(host) && !options.authorize) {
        throw new Error("Worker Admin requires authorize middleware when bound beyond loopback.");
    }
    const service = new WorkerAdminService(options);
    const server = createServer((request, response) => {
        void handleRequest(request, response, service, options).catch((error: unknown) => {
            writeError(response, error);
        });
    });
    let listening = false;
    return {
        service,
        server,
        start: async () => {
            if (listening) return;
            server.listen(options.port ?? 9_091, host);
            await once(server, "listening");
            listening = true;
        },
        close: async () => {
            if (!listening) return;
            server.close();
            await once(server, "close");
            listening = false;
        },
    };
}

async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
    service: WorkerAdminService,
    options: WorkerAdminServerOptions,
): Promise<void> {
    if (options.authorize && !(await options.authorize(request))) {
        throw new WorkerAdminRequestError("unauthorized", "Worker Admin authorization failed.", 401);
    }
    const url = new URL(request.url ?? "/", "http://worker-admin.local");
    const path = url.pathname;
    if (request.method === "GET" && path === "/healthz") {
        writeJson(response, 200, service.liveness());
        return;
    }
    if (request.method === "GET" && path === "/readyz") {
        const snapshot = await service.readiness();
        writeJson(response, snapshot.ready ? 200 : 503, snapshot);
        return;
    }
    if (request.method === "GET" && path === "/metrics") {
        writeText(response, 200, service.metrics());
        return;
    }
    if (request.method === "GET" && path === "/admin/v1/status") {
        writeJson(response, 200, service.status());
        return;
    }
    if (request.method === "GET" && path === "/admin/v1/capabilities") {
        writeJson(response, 200, service.capabilities());
        return;
    }
    if (request.method === "GET" && path === "/admin/v1/drains") {
        writeJson(response, 200, {
            items: service.listDrains(),
            nextCursor: null,
            snapshotAt: new Date().toISOString(),
        });
        return;
    }
    if (request.method === "POST" && path === "/admin/v1/drains") {
        const idempotencyKey = headerValue(request, "idempotency-key");
        if (!idempotencyKey) {
            throw new WorkerAdminRequestError(
                "invalid_request",
                "Idempotency-Key is required for Worker drain commands.",
                400,
            );
        }
        const body = await readJsonBody(request, options.maxBodyBytes ?? 64 * 1024);
        const decision = service.requestDrain(idempotencyKey, parseDrainCommand(body));
        writeJson(response, decision.statusCode, decision.snapshot);
        return;
    }
    const drainMatch = path.match(/^\/admin\/v1\/drains\/([^/]+)$/);
    if (request.method === "GET" && drainMatch) {
        const snapshot = service.getDrain(decodeURIComponent(drainMatch[1]));
        if (!snapshot) {
            throw new WorkerAdminRequestError("not_found", "Worker drain not found.", 404);
        }
        writeJson(response, 200, snapshot);
        return;
    }
    throw new WorkerAdminRequestError("not_found", "Worker Admin endpoint not found.", 404);
}

function defaultComponents(
    checkedAt: string,
    ready: boolean,
): WorkerReadinessSnapshot["components"] {
    const status: ComponentStatus = ready ? "ready" : "unknown";
    const component = (): ComponentHealth => ({ status, checkedAt });
    return {
        migration: component(),
        taskStore: component(),
        definitionCatalog: component(),
        actionRegistry: component(),
        connectorRegistry: component(),
        valueStore: component(),
    };
}

function sanitizeComponents(
    supplied: Partial<WorkerReadinessSnapshot["components"]>,
): Partial<WorkerReadinessSnapshot["components"]> {
    const safe: Partial<WorkerReadinessSnapshot["components"]> = {};
    if (supplied.migration) safe.migration = sanitizeComponent(supplied.migration);
    if (supplied.taskStore) safe.taskStore = sanitizeComponent(supplied.taskStore);
    if (supplied.gatewaySession) safe.gatewaySession = sanitizeComponent(supplied.gatewaySession);
    if (supplied.definitionCatalog) safe.definitionCatalog = sanitizeComponent(supplied.definitionCatalog);
    if (supplied.actionRegistry) safe.actionRegistry = sanitizeComponent(supplied.actionRegistry);
    if (supplied.connectorRegistry) safe.connectorRegistry = sanitizeComponent(supplied.connectorRegistry);
    if (supplied.valueStore) safe.valueStore = sanitizeComponent(supplied.valueStore);
    return safe;
}

function sanitizeComponent(component: ComponentHealth): ComponentHealth {
    return {
        status: component.status,
        checkedAt: component.checkedAt,
        ...(component.code === undefined || component.code === null ? {} : { code: publicFailureMessage(new Error(component.code)) }),
        ...(component.message === undefined || component.message === null ? {} : { message: publicFailureMessage(new Error(component.message)) }),
    };
}

function failureComponent(failure: FailureSnapshot, checkedAt: string): ComponentHealth {
    return {
        status: "unavailable",
        checkedAt,
        code: failure.code,
        message: failure.message,
    };
}

function parseDrainCommand(body: Record<string, unknown>): CreateDrainCommand {
    const command: CreateDrainCommand = {
        reason: validateReason(body.reason),
    };
    if ("deadlineMs" in body) {
        const deadlineMs = body.deadlineMs;
        if (deadlineMs !== null && typeof deadlineMs !== "number") {
            throw new WorkerAdminRequestError("invalid_request", "deadlineMs must be a number or null.", 400);
        }
        command.deadlineMs = deadlineMs === null ? null : normalizeDeadline(deadlineMs);
    }
    if ("exitAfterDrain" in body) {
        if (body.exitAfterDrain !== true) {
            throw new WorkerAdminRequestError("invalid_request", "exitAfterDrain must be true when provided.", 400);
        }
        command.exitAfterDrain = true;
    }
    return command;
}

function normalizeDeadline(value: number | null | undefined): number | null {
    if (value === null) return null;
    const deadline = value === undefined ? DEFAULT_DRAIN_DEADLINE_MS : value;
    if (!Number.isSafeInteger(deadline) || deadline < 0 || deadline > MAX_DRAIN_DEADLINE_MS) {
        throw new WorkerAdminRequestError(
            "invalid_request",
            `deadlineMs must be an integer between 0 and ${MAX_DRAIN_DEADLINE_MS}.`,
            400,
        );
    }
    return deadline;
}

function validateReason(value: unknown): string {
    if (typeof value !== "string") {
        throw new WorkerAdminRequestError("invalid_request", "reason is required.", 400);
    }
    const reason = value.trim();
    if (reason.length === 0 || reason.length > MAX_REASON_LENGTH) {
        throw new WorkerAdminRequestError(
            "invalid_request",
            `reason must contain 1-${MAX_REASON_LENGTH} characters.`,
            400,
        );
    }
    return reason;
}
function validateIdempotencyKey(value: string): string {
    const key = value.trim();
    if (key.length === 0 || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
        throw new WorkerAdminRequestError(
            "invalid_request",
            `Idempotency-Key must contain 1-${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`,
            400,
        );
    }
    return key;
}

function isTerminalDrain(status: WorkerDrainSnapshot["status"]): boolean {
    return status === "succeeded" || status === "timed_out" || status === "failed";
}

function cloneDrain(snapshot: WorkerDrainSnapshot): WorkerDrainSnapshot {
    return {
        ...snapshot,
        activeAttemptIds: [...snapshot.activeAttemptIds],
        activePollCount: snapshot.activePollCount,
        error: snapshot.error ? { ...snapshot.error } : null,
    };
}
function publicFailureMessage(error: unknown): string {
    if (!(error instanceof Error)) return "Worker operation failed.";
    return error.message
        .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
        .replace(/(?:[A-Za-z]:[\\/]|\/)(?:[^\s"'<>]+[\\/])*[^\s"'<>]*/g, "[path]")
        .replace(/(?:token|secret|password)\s*[=:]\s*[^\s,;]+/gi, "$1=[redacted]")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500) || "Worker operation failed.";
}
function toFailure(error: unknown, now: Date): FailureSnapshot {
    return failureSnapshot(
        "terminal",
        "worker_error",
        publicFailureMessage(error),
        false,
        now,
    );
}

function failureSnapshot(
    kind: FailureSnapshot["kind"],
    code: string,
    message: string,
    retryable: boolean,
    now: Date,
): FailureSnapshot {
    return {
        kind,
        code,
        message: message.replace(/\s+/g, " ").trim().slice(0, 500),
        retryable,
        occurredAt: now.toISOString(),
        detailsRef: null,
    };
}

function metricLabel(value: string): string {
    return value.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 64);
}

function isLoopbackOrInternalHost(host: string): boolean {
    return host === "127.0.0.1"
        || host === "::1"
        || host === "localhost";
}

function headerValue(request: IncomingMessage, name: string): string | null {
    const value = request.headers[name.toLowerCase()];
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
}

async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > maxBytes) {
            throw new WorkerAdminRequestError(
                "payload_too_large",
                "Worker Admin request body is too large.",
                413,
            );
        }
        chunks.push(buffer);
    }
    if (chunks.length === 0) return {};
    let parsed: unknown;
    try {
        parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
        throw new WorkerAdminRequestError("invalid_request", "Request body must be valid JSON.", 400);
    }
    if (!isRecord(parsed)) {
        throw new WorkerAdminRequestError("invalid_request", "Request body must be a JSON object.", 400);
    }
    return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
    const body = JSON.stringify(value);
    response.statusCode = statusCode;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("content-length", Buffer.byteLength(body));
    response.end(body);
}

function writeText(response: ServerResponse, statusCode: number, body: string): void {
    response.statusCode = statusCode;
    response.setHeader("content-type", "text/plain; version=0.0.4; charset=utf-8");
    response.setHeader("content-length", Buffer.byteLength(body));
    response.end(body);
}

function writeError(response: ServerResponse, error: unknown): void {
    if (response.headersSent) {
        response.destroy();
        return;
    }
    if (error instanceof WorkerAdminRequestError) {
        writeJson(response, error.statusCode, {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
        });
        return;
    }
    writeJson(response, 500, {
        code: "internal_error",
        message: "Worker Admin request failed.",
        retryable: true,
    });
}


async function delay(milliseconds: number): Promise<void> {
    await delayTimer(milliseconds);
}
