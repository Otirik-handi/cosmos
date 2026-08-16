import { randomUUID } from "node:crypto";

import { retryPolicySchema, type RetryPolicy } from "@cosmos/contracts";

import { PrismaClient, type Prisma } from "@prisma/client";

import {
    assertJsonValue,
    canonicalJson,
    fingerprint,
    type ActivityExecutionRequest,
    type ActivityIdentity,
    type DeferredActivityCompletionInput,
    type DeferredActivityStartResult,
    type JsonValue,
    type WorkflowDefinitionReference,
} from "@notnotype/nb-workflow";
import {
    WorkflowHostConflictError,
    WorkflowHostError,
    type ActivityJobLease,
    type ActivityJobTerminalResult,
    type ClaimActivityJobInput,
    type ClaimWorkflowCompletionInput,
    type ClaimWorkflowRunInput,
    type CompleteActivityInput,
    type CompleteActivityResult,
    type CreateWorkflowEnvelopeInput,
    type DeadLetterWorkflowCompletionInput,
    type DeliverWorkflowCompletionInput,
    type HeartbeatActivityJobInput,
    type HeartbeatWorkflowCompletionInput,
    type HeartbeatWorkflowRunInput,
    type MarkResumeRequiredInput,
    type RecoveryRunsInput,
    type ReleaseActivityJobInput,
    type ReleaseWorkflowRunInput,
    type RequeueWorkflowCompletionInput,
    type WorkflowActivityJobClaim,
    type WorkflowActivityJobPayload,
    type WorkflowCompletion,
    type WorkflowCompletionClaim,
    type WorkflowEnvelope,
    type WorkflowHostStore,
    type WorkflowJobStatus,
    type WorkflowRunLease,
    type WorkflowRunStatus,
    type LoggerPort,
} from "@cosmos/application";

import {
    createWorkflowEnvelopeMarker,
    isWorkflowEnvelopeMarker,
} from "./workflow-backend.js";

const ACTIVITY_KIND = "workflow-activity" as const;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_COMPLETION_MAX_ATTEMPTS = 5;
const TERMINAL_RUN_STATUSES = ["completed", "failed", "cancelled"] as const;
const RECOVERABLE_RUN_STATUSES = ["running", "waiting"] as const;
const VALID_RUN_STATUSES = [
    "queued",
    "running",
    "waiting",
    "completed",
    "failed",
    "cancelled",
] as const;
const VALID_JOB_STATUSES = [
    "queued",
    "leased",
    "retry_wait",
    "succeeded",
    "failed_terminal",
    "cancelled",
] as const;
const VALID_COMPLETION_STATUSES = [
    "queued",
    "leased",
    "delivered",
    "dead_letter",
] as const;

/**
 * Prisma implementation of the durable Host boundary.
 *
 * The legacy `Run`/`Job` lane remains owned by PrismaCosmosRepository. This
 * class only touches `WorkflowRun` rows and Jobs explicitly attached to one
 * such row (`kind = workflow-activity`). Every state transition is guarded by
 * the relevant lease token, owner and current status in the same transaction.
 */
export class PrismaWorkflowHostStore implements WorkflowHostStore {
    readonly prisma: PrismaClient;
    private readonly logger?: LoggerPort;
    private readonly actionRetryPolicies?: Readonly<Record<string, RetryPolicy>>;

    constructor(prisma: PrismaClient, options?: { logger?: LoggerPort; actionRetryPolicies?: Readonly<Record<string, RetryPolicy>> });
    constructor(options: PrismaOptions);
    constructor(
        input: PrismaClient | PrismaOptions,
        options?: { logger?: LoggerPort; actionRetryPolicies?: Readonly<Record<string, RetryPolicy>> },
    ) {
        if (isPrismaOptions(input)) {
            this.prisma = input.prisma;
            this.logger = input.logger;
            this.actionRetryPolicies = input.actionRetryPolicies;
        } else {
            this.prisma = input;
            this.logger = options?.logger;
            this.actionRetryPolicies = options?.actionRetryPolicies;
        }
    }

    async createWorkflowEnvelope(
        input: CreateWorkflowEnvelopeInput,
    ): Promise<WorkflowEnvelope> {
        const normalized = normalizeEnvelopeInput(input);
        const inputSnapshotJson = encodeJson(
            normalized.inputSnapshot,
            "workflow input snapshot",
        );
        const productRunJson = encodeJson(
            normalized.productRun,
            "product run snapshot",
        );

        try {
            return await this.prisma.$transaction(async (tx) => {
                if (normalized.idempotencyKey !== null) {
                    const byKey = await tx.workflowRun.findUnique({
                        where: { idempotencyKey: normalized.idempotencyKey },
                    });
                    if (byKey) {
                        return assertEnvelopeIdentity(
                            byKey as WorkflowRunRow,
                            normalized,
                            inputSnapshotJson,
                            productRunJson,
                        );
                    }
                }

                const byId = await tx.workflowRun.findUnique({
                    where: { id: normalized.runId },
                });
                if (byId) {
                    if (
                        normalized.idempotencyKey !== null
                        && byId.idempotencyKey === normalized.idempotencyKey
                    ) {
                        return assertEnvelopeIdentity(
                            byId as WorkflowRunRow,
                            normalized,
                            inputSnapshotJson,
                            productRunJson,
                        );
                    }
                    throw new WorkflowHostConflictError(
                        `Workflow run ${normalized.runId} already exists.`,
                    );
                }

                const now = normalized.createdAt;
                const row = await tx.workflowRun.create({
                    data: {
                        id: normalized.runId,
                        stateJson: canonicalJson(
                            createWorkflowEnvelopeMarker(normalized.runId),
                        ),
                        kernelRevision: 0,
                        status: "queued",
                        resumeRequired: false,
                        definitionKey: normalized.definition.key,
                        definitionVersion: normalized.definition.version,
                        manifestHash: normalized.definition.manifestHash,
                        idempotencyKey: normalized.idempotencyKey,
                        inputSnapshotJson,
                        productRunJson,
                        runLeaseOwner: null,
                        runLeaseToken: null,
                        runLeaseExpiresAt: null,
                        startedAt: null,
                        finishedAt: null,
                        createdAt: now,
                        updatedAt: now,
                    },
                });
                await appendWorkflowRunQueuedEvent(tx, {
                    workflowRunId: row.id,
                    productRun: normalized.productRun,
                });
                return toEnvelope(row as WorkflowRunRow);
            });
        } catch (error) {
            if (!isUniqueConstraintError(error)) {
                throw error;
            }

            // A concurrent creator may win either the id or idempotency-key
            // unique constraint. Re-read the durable winner and apply the same
            // identity check instead of returning a possibly different run.
            if (normalized.idempotencyKey !== null) {
                const winner = await this.prisma.workflowRun.findUnique({
                    where: { idempotencyKey: normalized.idempotencyKey },
                });
                if (winner) {
                    return assertEnvelopeIdentity(
                        winner as WorkflowRunRow,
                        normalized,
                        inputSnapshotJson,
                        productRunJson,
                    );
                }
            }
            const winner = await this.prisma.workflowRun.findUnique({
                where: { id: normalized.runId },
            });
            if (winner) {
                throw new WorkflowHostConflictError(
                    `Workflow run ${normalized.runId} already exists.`,
                    { cause: error },
                );
            }
            throw new WorkflowHostError(
                "unavailable",
                "Workflow envelope creation lost its unique-key race without a durable winner.",
                { cause: error },
            );
        }
    }
    async findWorkflowEnvelopeByIdempotencyKey(
        idempotencyKey: string,
    ): Promise<WorkflowEnvelope | null> {
        const row = await this.prisma.workflowRun.findUnique({
            where: { idempotencyKey: requireNonEmptyString(idempotencyKey, "idempotencyKey") },
        });
        return row ? toEnvelope(row as WorkflowRunRow) : null;
    }

    async hasWorkflowKernelState(runId: string): Promise<boolean> {
        const row = await this.prisma.workflowRun.findUnique({
            where: { id: requireNonEmptyString(runId, "runId") },
            select: { id: true, stateJson: true },
        });
        if (!row) return false;
        const parsed = parseJson(row.stateJson, `Workflow run ${row.id} state`);
        return !isWorkflowEnvelopeMarker(parsed, row.id);
    }

    /** Load both envelope-only rows and adopted Kernel rows. */
    async loadWorkflowEnvelope(runId: string): Promise<WorkflowEnvelope | null> {
        const row = await this.prisma.workflowRun.findUnique({
            where: { id: requireNonEmptyString(runId, "runId") },
        });
        return row ? toEnvelope(row as WorkflowRunRow) : null;
    }

    async claimRun(input: ClaimWorkflowRunInput): Promise<WorkflowRunLease | null> {
        validateLeaseMs(input.leaseMs);
        const owner = requireNonEmptyString(input.owner, "owner");
        const now = input.now ?? new Date();
        assertValidDate(now, "now");
        const purpose = input.purpose ?? "execution";
        const requestedRunId = input.runId === undefined
            ? undefined
            : requireNonEmptyString(input.runId, "runId");
        if (purpose !== "execution" && requestedRunId === undefined) {
            throw invalidState(`Run claim purpose ${purpose} requires a runId.`);
        }

        return this.prisma.$transaction(async (tx) => {
            const candidate = await tx.workflowRun.findFirst({
                where: purpose === "execution"
                    ? {
                        ...(requestedRunId ? { id: requestedRunId } : {}),
                        OR: [
                            { status: "queued" },
                            { status: "running" },
                            { status: "waiting", resumeRequired: true },
                        ],
                        AND: [{
                            OR: [
                                {
                                    runLeaseOwner: null,
                                    runLeaseToken: null,
                                    runLeaseExpiresAt: null,
                                },
                                { runLeaseExpiresAt: { lte: now } },
                            ],
                        }],
                    }
                    : {
                        id: requestedRunId!,
                        AND: [
                            {
                                OR: [
                                    { status: { notIn: [...TERMINAL_RUN_STATUSES] } },
                                    {
                                        status: { in: [...TERMINAL_RUN_STATUSES] },
                                        completions: {
                                            some: {
                                                status: "leased",
                                                leaseOwner: owner,
                                                leaseExpiresAt: { gt: now },
                                            },
                                        },
                                    },
                                ],
                            },
                            {
                                OR: [
                                    {
                                        runLeaseOwner: null,
                                        runLeaseToken: null,
                                        runLeaseExpiresAt: null,
                                    },
                                    { runLeaseExpiresAt: { lte: now } },
                                ],
                            },
                        ],
                    },
                orderBy: purpose === "execution"
                    ? [{ createdAt: "asc" }, { id: "asc" }]
                    : undefined,
            });
            if (!candidate && purpose !== "execution" && requestedRunId) {
                const existing = await tx.workflowRun.findUnique({
                    where: { id: requestedRunId },
                });
                if (
                    existing
                    && existing.runLeaseOwner === owner
                    && existing.runLeaseToken
                    && existing.runLeaseExpiresAt
                    && existing.runLeaseExpiresAt.getTime() > now.getTime()
                ) {
                    return {
                        runId: existing.id,
                        leaseToken: existing.runLeaseToken,
                        owner,
                        leaseExpiresAt: existing.runLeaseExpiresAt.toISOString(),
                    };
                }
                return null;
            }
            if (!candidate) {
                return null;
            }

            const leaseToken = randomUUID();
            const leaseExpiresAt = new Date(now.getTime() + input.leaseMs);
            const leaseGuard = previousRunLeaseGuard(candidate as WorkflowRunRow);
            const updated = await tx.workflowRun.updateMany({
                where: {
                    id: candidate.id,
                    status: candidate.status,
                    resumeRequired: candidate.resumeRequired,
                    ...leaseGuard,
                },
                data: purpose === "execution"
                    ? {
                        status: "running",
                        resumeRequired: candidate.resumeRequired,
                        runLeaseOwner: owner,
                        runLeaseToken: leaseToken,
                        runLeaseExpiresAt: leaseExpiresAt,
                        startedAt: candidate.startedAt ?? now,
                    }
                    : {
                        runLeaseOwner: owner,
                        runLeaseToken: leaseToken,
                        runLeaseExpiresAt: leaseExpiresAt,
                        startedAt: candidate.startedAt ?? now,
                    }
            });
            if (updated.count !== 1) {
                return null;
            }
            return {
                runId: candidate.id,
                leaseToken,
                owner,
                leaseExpiresAt: leaseExpiresAt.toISOString(),
            };
        });
    }

    async heartbeatRun(input: HeartbeatWorkflowRunInput): Promise<boolean> {
        validateLeaseMs(input.leaseMs);
        const now = input.now ?? new Date();
        assertValidDate(now, "now");
        const result = await this.prisma.workflowRun.updateMany({
            where: {
                id: requireNonEmptyString(input.runId, "runId"),
                runLeaseOwner: requireNonEmptyString(input.owner, "owner"),
                runLeaseToken: requireNonEmptyString(input.leaseToken, "leaseToken"),
                runLeaseExpiresAt: { gt: now },
                status: { in: ["running", "waiting"] },
            },
            data: {
                runLeaseExpiresAt: new Date(now.getTime() + input.leaseMs),
            },
        });
        return result.count === 1;
    }

    async releaseRun(input: ReleaseWorkflowRunInput): Promise<boolean> {
        const now = input.now ?? new Date();
        assertValidDate(now, "now");
        const result = await this.prisma.workflowRun.updateMany({
            where: {
                id: requireNonEmptyString(input.runId, "runId"),
                runLeaseOwner: requireNonEmptyString(input.owner, "owner"),
                runLeaseToken: requireNonEmptyString(input.leaseToken, "leaseToken"),
                runLeaseExpiresAt: { gt: now },
            },
            data: {
                runLeaseOwner: null,
                runLeaseToken: null,
                runLeaseExpiresAt: null,
            },
        });
        return result.count === 1;
    }

    async startAction(
        request: ActivityExecutionRequest,
    ): Promise<DeferredActivityStartResult> {
        const normalized = normalizeActivityRequest(request);
        const retryPolicy = this.actionRetryPolicies?.[normalized.reference];
        const payload: WorkflowActivityJobPayload = {
            runId: normalized.runId,
            activity: normalized.activity,
            reference: normalized.reference,
            input: normalized.input,
            options: normalized.options,
            idempotencyKey: normalized.idempotencyKey,
            ...(retryPolicy === undefined ? {} : { retryPolicy }),
        };
        const payloadJson = canonicalJson(payload);
        const identityJson = activityIdentityJson(payload);

        try {
            return await this.prisma.$transaction(async (tx) => {
                const run = await tx.workflowRun.findUnique({
                    where: { id: normalized.runId },
                });
                if (!run) {
                    throw new WorkflowHostError(
                        "not_found",
                        `Workflow run ${normalized.runId} was not found.`,
                    );
                }
                if (isTerminalRunStatus(run.status)) {
                    throw new WorkflowHostConflictError(
                        `Cannot start Activity on terminal Workflow run ${normalized.runId} (${run.status}).`,
                    );
                }

                const existing = await tx.job.findUnique({
                    where: { idempotencyKey: normalized.idempotencyKey },
                });
                if (existing) {
                    return existingActionResult(
                        existing as ActivityJobRow,
                        normalized,
                        identityJson,
                    );
                }
                const row = await tx.job.create({
                    data: {
                        id: randomUUID(),
                        runId: null,
                        stepId: null,
                        workflowRunId: normalized.runId,
                        workflowKernelRevision: null,
                        kind: ACTIVITY_KIND,
                        status: "queued",
                        payloadJson,
                        resultJson: null,
                        idempotencyKey: normalized.idempotencyKey,
                        attempts: 0,
                        maxAttempts: retryPolicy?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
                        leaseOwner: null,
                        leaseToken: null,
                        leaseExpiresAt: null,
                        nextAttemptAt: null,
                        errorCode: null,
                        errorMessage: null,
                    },
                });
                return {
                    status: "pending",
                    receipt: row.id,
                    reason: "workflow-activity",
                } satisfies DeferredActivityStartResult;
            });
        } catch (error) {
            if (!isUniqueConstraintError(error)) {
                throw error;
            }
            const winner = await this.prisma.job.findUnique({
                where: { idempotencyKey: normalized.idempotencyKey },
            });
            if (!winner) {
                throw new WorkflowHostError(
                    "unavailable",
                    "Activity creation lost its unique-key race without a durable winner.",
                    { cause: error },
                );
            }
            return existingActionResult(
                winner as ActivityJobRow,
                normalized,
                identityJson,
            );
        }
    }

    async claimActivityJob(
        input: ClaimActivityJobInput,
    ): Promise<WorkflowActivityJobClaim | null> {
        validateLeaseMs(input.leaseMs);
        const owner = requireNonEmptyString(input.owner, "owner");
        const now = input.now ?? new Date();
        assertValidDate(now, "now");

        return this.prisma.$transaction(async (tx) => {
            const candidates = await tx.job.findMany({
                where: {
                    kind: ACTIVITY_KIND,
                    workflowRun: {
                        is: { status: { notIn: [...TERMINAL_RUN_STATUSES] } },
                    },
                    OR: [
                        {
                            status: { in: ["queued", "retry_wait"] },
                            OR: [
                                { nextAttemptAt: null },
                                { nextAttemptAt: { lte: now } },
                            ],
                        },
                        { status: "leased", leaseExpiresAt: { lte: now } },
                    ],
                },
                orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                take: 100,
            });

            for (const candidate of candidates) {
                if (!candidate.workflowRunId) {
                    throw invalidState(`Activity Job ${candidate.id} has no Workflow run.`);
                }
                const payload = parseActivityPayload(candidate.payloadJson, candidate.id);
                const workflowRun = await tx.workflowRun.findUnique({
                    where: { id: candidate.workflowRunId },
                });
                if (!workflowRun) {
                    throw invalidState(`Activity Job ${candidate.id} has no Workflow run.`);
                }
                if (
                    workflowRun.runLeaseExpiresAt
                    && workflowRun.runLeaseExpiresAt.getTime() > now.getTime()
                    && workflowRun.runLeaseOwner !== null
                    && workflowRun.runLeaseOwner !== owner
                ) {
                    continue;
                }
                const state = parseJson(
                    workflowRun.stateJson,
                    `Workflow run ${workflowRun.id} state`,
                );
                const pending = pendingActivityForState(state, payload, candidate.id);
                if (isWorkflowEnvelopeMarker(state, workflowRun.id) || !pending) {
                    // startAction and Kernel persistence are separate transactions;
                    // leave an orphan queued Job for Run recovery instead of executing it.
                    continue;
                }
                if (candidate.attempts >= candidate.maxAttempts) {
                    const error = "Activity Job exceeded its maximum attempts.";
                    const completion: DeferredActivityCompletionInput = {
                        activityKey: payload.activity.key,
                        receipt: candidate.id,
                        reference: payload.reference,
                        fingerprint: payload.activity.fingerprint,
                        status: "failed",
                        error,
                    };
                    const updated = await tx.job.updateMany({
                        where: {
                            id: candidate.id,
                            kind: ACTIVITY_KIND,
                            status: candidate.status,
                            ...previousJobLeaseGuard(candidate as ActivityJobRow),
                        },
                        data: {
                            status: "failed_terminal",
                            resultJson: null,
                            errorCode: "max_attempts",
                            errorMessage: error,
                            workflowKernelRevision: workflowRun.kernelRevision,
                            leaseOwner: null,
                            leaseToken: null,
                            leaseExpiresAt: null,
                            nextAttemptAt: null,
                        },
                    });
                    if (updated.count !== 1) continue;
                    await tx.workflowCompletion.create({
                        data: {
                            id: randomUUID(),
                            workflowRunId: candidate.workflowRunId,
                            jobId: candidate.id,
                            activityKey: completion.activityKey,
                            receipt: completion.receipt,
                            reference: completion.reference,
                            fingerprint: completion.fingerprint,
                            completionJson: encodeJson(completion, "Activity completion"),
                            status: "queued",
                            attempts: 0,
                            maxAttempts: DEFAULT_COMPLETION_MAX_ATTEMPTS,
                            availableAt: now,
                            leaseOwner: null,
                            leaseToken: null,
                            leaseExpiresAt: null,
                            lastError: null,
                        },
                    });
                    await appendActivityLifecycleEvent(tx, {
                        workflowRunId: candidate.workflowRunId,
                        jobId: candidate.id,
                        attempt: candidate.attempts,
                        owner,
                        expiresAt: null,
                        status: "failed_terminal",
                        error,
                        idempotencyKey: `${candidate.id}:attempt:${candidate.attempts}:terminal`,
                    });
                    continue;
                }

                const leaseToken = randomUUID();
                const leaseExpiresAt = new Date(now.getTime() + input.leaseMs);
                const updated = await tx.job.updateMany({
                    where: {
                        id: candidate.id,
                        kind: ACTIVITY_KIND,
                        workflowRunId: candidate.workflowRunId,
                        status: candidate.status,
                        ...previousJobLeaseGuard(candidate as ActivityJobRow),
                    },
                    data: {
                        status: "leased",
                        workflowKernelRevision: workflowRun.kernelRevision,
                        attempts: { increment: 1 },
                        leaseOwner: owner,
                        leaseToken,
                        leaseExpiresAt,
                        nextAttemptAt: null,
                    },
                });
                if (updated.count !== 1) continue;
                const claimed = await tx.job.findUnique({ where: { id: candidate.id } });
                if (!claimed) {
                    throw new WorkflowHostError(
                        "not_found",
                        `Activity Job ${candidate.id} disappeared after claim.`,
                    );
                }
                const claimedRow = claimed as ActivityJobRow;
                await appendActivityLifecycleEvent(tx, {
                    workflowRunId: candidate.workflowRunId,
                    jobId: candidate.id,
                    attempt: claimedRow.attempts,
                    owner,
                    expiresAt: leaseExpiresAt,
                    status: "leased",
                    idempotencyKey: `${candidate.id}:attempt:${claimedRow.attempts}:leased`,
                });
                return toActivityJobClaim(claimedRow, payload, owner, leaseToken);
            }
            return null;
        });
    }

    async heartbeatActivityJob(input: HeartbeatActivityJobInput): Promise<boolean> {
        validateLeaseMs(input.leaseMs);
        const now = input.now ?? new Date();
        assertValidDate(now, "now");
        const result = await this.prisma.job.updateMany({
            where: {
                id: requireNonEmptyString(input.jobId, "jobId"),
                kind: ACTIVITY_KIND,
                status: "leased",
                leaseOwner: requireNonEmptyString(input.owner, "owner"),
                leaseToken: requireNonEmptyString(input.leaseToken, "leaseToken"),
                leaseExpiresAt: { gt: now },
            },
            data: {
                leaseExpiresAt: new Date(now.getTime() + input.leaseMs),
            },
        });
        return result.count === 1;
    }

    async releaseActivityJob(input: ReleaseActivityJobInput): Promise<boolean> {
        const now = input.now ?? new Date();
        assertValidDate(now, "now");
        const jobId = requireNonEmptyString(input.jobId, "jobId");
        const owner = requireNonEmptyString(input.owner, "owner");
        const leaseToken = requireNonEmptyString(input.leaseToken, "leaseToken");
        const updated = await this.prisma.job.updateMany({
            where: {
                id: jobId,
                kind: ACTIVITY_KIND,
                status: "leased",
                leaseOwner: owner,
                leaseToken,
                leaseExpiresAt: { gt: now },
            },
            data: {
                status: "queued",
                leaseOwner: null,
                leaseToken: null,
                leaseExpiresAt: null,
                nextAttemptAt: now,
                ...(input.reason === undefined ? {} : {
                    errorCode: "lease_unavailable",
                    errorMessage: input.reason,
                }),
            },
        });
        if (updated.count === 1) {
            const job = await this.prisma.job.findUnique({ where: { id: jobId } });
            if (job?.workflowRunId) {
                await this.prisma.$transaction(async (tx) => {
                    await appendActivityLifecycleEvent(tx, {
                        workflowRunId: job.workflowRunId!,
                        jobId,
                        attempt: job.attempts,
                        owner,
                        expiresAt: null,
                        status: "released",
                        ...(input.reason === undefined ? {} : { error: input.reason ?? undefined }),
                        idempotencyKey: `${jobId}:attempt:${job.attempts}:released:${now.toISOString()}`,
                    });
                });
            }
        }
        return updated.count === 1;
    }

    async completeActivity(input: CompleteActivityInput): Promise<CompleteActivityResult> {
        const now = input.now ?? new Date();
        assertValidDate(now, "now");
        validateActivityTerminalResult(input.result);
        const jobLease = normalizeActivityJobLease(input.jobLease);
        const runLease = normalizeRunLease(input.runLease);

        return this.prisma.$transaction(async (tx) => {
            const job = await tx.job.findUnique({ where: { id: jobLease.jobId } });
            if (!job || job.kind !== ACTIVITY_KIND) {
                return rejectedActivityResult(job?.status);
            }
            if (!job.workflowRunId || job.workflowRunId !== runLease.runId) {
                return rejectedActivityResult(job.status);
            }
            const payload = parseActivityPayload(job.payloadJson, job.id);
            const completion = validateCompletionForJob(
                input.result,
                input.completion,
                payload,
                job.id,
            );
            const run = await tx.workflowRun.findUnique({ where: { id: job.workflowRunId } });
            if (!run || isTerminalRunStatus(run.status) || !hasCurrentRunLease(run as WorkflowRunRow, runLease, now)) {
                return rejectedActivityResult(job.status);
            }
            const jobRow = job as ActivityJobRow;
            const state = parseJson(run.stateJson, `Workflow run ${run.id} state`);
            const pending = pendingActivityForState(state, payload, job.id);
            if (
                jobRow.workflowKernelRevision === null
                || jobRow.workflowKernelRevision !== run.kernelRevision
                || !pending
            ) {
                return rejectedActivityResult(job.status);
            }

            const jobLeaseCurrent = job.status === "leased"
                && job.leaseOwner === jobLease.owner
                && job.leaseToken === jobLease.leaseToken
                && job.leaseExpiresAt !== null
                && job.leaseExpiresAt.getTime() > now.getTime();
            if (!jobLeaseCurrent) {
                if (
                    completion
                    && input.result.status !== "retry_wait"
                    && ["succeeded", "failed_terminal", "cancelled"].includes(job.status)
                ) {
                    const existing = await tx.workflowCompletion.findUnique({ where: { jobId: job.id } });
                    if (existing) {
                        const persisted = toCompletion(existing as WorkflowCompletionRow);
                        if (!sameCompletionIdentity(persisted.completion, completion)) {
                            throw new WorkflowHostConflictError(
                                `Activity completion identity conflicts with existing Job ${job.id} completion.`,
                            );
                        }
                        return {
                            accepted: true,
                            jobStatus: job.status as WorkflowJobStatus,
                            completion: persisted,
                        } satisfies CompleteActivityResult;
                    }
                }
                return rejectedActivityResult(job.status);
            }

            if (input.result.status !== "retry_wait") {
                const existing = await tx.workflowCompletion.findUnique({ where: { jobId: job.id } });
                if (existing) {
                    const persisted = toCompletion(existing as WorkflowCompletionRow);
                    if (!completion || !sameCompletionIdentity(persisted.completion, completion)) {
                        throw new WorkflowHostConflictError(
                            `Activity completion identity conflicts with existing Job ${job.id} completion.`,
                        );
                    }
                    return {
                        accepted: true,
                        jobStatus: job.status as WorkflowJobStatus,
                        completion: persisted,
                    } satisfies CompleteActivityResult;
                }
            }

            const nextAttemptAt = input.result.status === "retry_wait"
                ? new Date(now.getTime() + normalizeRetryDelay(input.result.retryDelayMs))
                : null;
            const updated = await tx.job.updateMany({
                where: {
                    id: job.id,
                    kind: ACTIVITY_KIND,
                    workflowRunId: job.workflowRunId,
                    status: "leased",
                    leaseOwner: jobLease.owner,
                    leaseToken: jobLease.leaseToken,
                    leaseExpiresAt: { gt: now },
                    workflowKernelRevision: run.kernelRevision,
                },
                data: {
                    status: input.result.status,
                    resultJson: input.result.result === undefined
                        ? null
                        : encodeJson(input.result.result, "Activity result"),
                    errorCode: input.result.errorCode ?? null,
                    errorMessage: input.result.error ?? null,
                    leaseOwner: null,
                    leaseToken: null,
                    leaseExpiresAt: null,
                    nextAttemptAt,
                },
            });
            if (updated.count !== 1) return rejectedActivityResult(job.status);

            await appendActivityLifecycleEvent(tx, {
                workflowRunId: job.workflowRunId,
                jobId: job.id,
                attempt: job.attempts,
                owner: jobLease.owner,
                expiresAt: null,
                status: input.result.status,
                ...(input.result.error ? { error: input.result.error } : {}),
                idempotencyKey: `${job.id}:attempt:${job.attempts}:terminal`,
            });
            if (input.result.status === "retry_wait") {
                return {
                    accepted: true,
                    jobStatus: "retry_wait",
                    completion: null,
                } satisfies CompleteActivityResult;
            }
            if (!completion) throw invalidState("Terminal Activity result was not given a completion.");
            try {
                const completionRow = await tx.workflowCompletion.create({
                    data: {
                        id: randomUUID(),
                        workflowRunId: job.workflowRunId,
                        jobId: job.id,
                        activityKey: completion.activityKey,
                        receipt: completion.receipt,
                        reference: completion.reference,
                        fingerprint: completion.fingerprint,
                        completionJson: encodeJson(completion, "Activity completion"),
                        status: "queued",
                        attempts: 0,
                        maxAttempts: DEFAULT_COMPLETION_MAX_ATTEMPTS,
                        availableAt: now,
                        leaseOwner: null,
                        leaseToken: null,
                        leaseExpiresAt: null,
                        lastError: null,
                    },
                });
                return {
                    accepted: true,
                    jobStatus: input.result.status,
                    completion: toCompletion(completionRow as WorkflowCompletionRow),
                } satisfies CompleteActivityResult;
            } catch (error) {
                if (!isUniqueConstraintError(error)) throw error;
                const existing = await tx.workflowCompletion.findUnique({ where: { jobId: job.id } });
                if (!existing) throw error;
                const persisted = toCompletion(existing as WorkflowCompletionRow);
                if (!sameCompletionIdentity(persisted.completion, completion)) {
                    throw new WorkflowHostConflictError(
                        `Activity completion identity conflicts with existing Job ${job.id} completion.`,
                        { cause: error },
                    );
                }
                return {
                    accepted: true,
                    jobStatus: job.status as WorkflowJobStatus,
                    completion: persisted,
                } satisfies CompleteActivityResult;
            }
        });
    }

    async heartbeatWorkflowCompletion(
        input: HeartbeatWorkflowCompletionInput,
    ): Promise<boolean> {
        validateLeaseMs(input.leaseMs);
        const now = input.now ?? new Date();
        assertValidDate(now, "now");
        const result = await this.prisma.workflowCompletion.updateMany({
            where: {
                id: requireNonEmptyString(input.completionId, "completionId"),
                status: "leased",
                leaseOwner: requireNonEmptyString(input.owner, "owner"),
                leaseToken: requireNonEmptyString(input.leaseToken, "leaseToken"),
                leaseExpiresAt: { gt: now },
            },
            data: {
                leaseExpiresAt: new Date(now.getTime() + input.leaseMs),
            },
        });
        return result.count === 1;
    }

    async claimWorkflowCompletion(
        input: ClaimWorkflowCompletionInput,
    ): Promise<WorkflowCompletionClaim | null> {
        validateLeaseMs(input.leaseMs);
        const owner = requireNonEmptyString(input.owner, "owner");
        const now = input.now ?? new Date();
        assertValidDate(now, "now");

        return this.prisma.$transaction(async (tx) => {
            const candidates = await tx.workflowCompletion.findMany({
                where: {
                    availableAt: { lte: now },
                    OR: [
                        { status: "queued" },
                        { status: "leased", leaseExpiresAt: { lte: now } },
                    ],
                },
                orderBy: [
                    { availableAt: "asc" },
                    { createdAt: "asc" },
                    { id: "asc" },
                ],
                take: 100,
            });
            for (const candidate of candidates) {
                const completionRow = candidate as WorkflowCompletionRow;
                const completion = toCompletion(completionRow);
                if (completionRow.attempts >= completionRow.maxAttempts) {
                    const exhausted = await tx.workflowCompletion.updateMany({
                        where: {
                            id: candidate.id,
                            status: candidate.status,
                            ...previousCompletionLeaseGuard(completionRow),
                        },
                        data: {
                            status: "dead_letter",
                            lastError: completionRow.lastError
                                ?? "Workflow completion exceeded maximum delivery attempts.",
                            leaseOwner: null,
                            leaseToken: null,
                            leaseExpiresAt: null,
                        },
                    });
                    if (exhausted.count === 1) {
                        this.logger?.warn("workflow.completion.max_attempts", {
                            completionId: candidate.id,
                            workflowRunId: candidate.workflowRunId,
                        });
                    }
                    continue;
                }
                const leaseToken = randomUUID();
                const leaseExpiresAt = new Date(now.getTime() + input.leaseMs);
                const updated = await tx.workflowCompletion.updateMany({
                    where: {
                        id: candidate.id,
                        status: candidate.status,
                        ...previousCompletionLeaseGuard(completionRow),
                    },
                    data: {
                        status: "leased",
                        attempts: { increment: 1 },
                        leaseOwner: owner,
                        leaseToken,
                        leaseExpiresAt,
                    },
                });
                if (updated.count !== 1) continue;
                const claimed = await tx.workflowCompletion.findUnique({
                    where: { id: candidate.id },
                });
                if (!claimed) {
                    throw new WorkflowHostError(
                        "not_found",
                        `Workflow completion ${candidate.id} disappeared after claim.`,
                    );
                }
                const claimedRow = claimed as WorkflowCompletionRow;
                return {
                    ...completion,
                    status: "leased",
                    leaseOwner: owner,
                    leaseToken,
                    leaseExpiresAt: leaseExpiresAt.toISOString(),
                    attempts: claimedRow.attempts,
                    maxAttempts: claimedRow.maxAttempts,
                    updatedAt: claimedRow.updatedAt.toISOString(),
                } satisfies WorkflowCompletionClaim;
            }
            return null;
        });
    }

    async deliverWorkflowCompletion(
        input: DeliverWorkflowCompletionInput,
    ): Promise<boolean> {
        const now = input.now ?? new Date();
        assertValidDate(now, "now");
        const completionId = requireNonEmptyString(input.completionId, "completionId");
        const owner = requireNonEmptyString(input.owner, "owner");
        const leaseToken = requireNonEmptyString(input.leaseToken, "leaseToken");
        const runLease = normalizeRunLease(input.runLease);

        return this.prisma.$transaction(async (tx) => {
            const completionRow = await tx.workflowCompletion.findFirst({
                where: {
                    id: completionId,
                    status: "leased",
                    leaseOwner: owner,
                    leaseToken,
                    leaseExpiresAt: { gt: now },
                    workflowRunId: runLease.runId,
                },
            });
            if (!completionRow) return false;
            const completion = toCompletion(completionRow as WorkflowCompletionRow);
            const run = await tx.workflowRun.findUnique({ where: { id: runLease.runId } });
            if (!run || !hasCurrentRunLease(run as WorkflowRunRow, runLease, now)) return false;
            const state = parseJson(run.stateJson, `Workflow run ${run.id} state`);
            const accepted = activityCompletionForState(
                state,
                completion.completion,
                run.kernelRevision,
            );
            if (!accepted) return false;
            const updated = await tx.workflowCompletion.updateMany({
                where: {
                    id: completionId,
                    status: "leased",
                    leaseOwner: owner,
                    leaseToken,
                    leaseExpiresAt: { gt: now },
                    workflowRunId: runLease.runId,
                },
                data: {
                    status: "delivered",
                    leaseOwner: null,
                    leaseToken: null,
                    leaseExpiresAt: null,
                },
            });
            return updated.count === 1;
        });
    }
    async requeueWorkflowCompletion(
        input: RequeueWorkflowCompletionInput,
    ): Promise<boolean> {
        const now = input.now ?? new Date();
        assertValidDate(now, "now");
        const requestedAt = input.availableAt === undefined
            ? new Date(now.getTime() + completionBackoffMs(1))
            : parseIsoDate(input.availableAt, "availableAt");
        const error = input.error === undefined || input.error === null
            ? null
            : String(input.error);
        return this.prisma.$transaction(async (tx) => {
            const row = await tx.workflowCompletion.findUnique({
                where: { id: requireNonEmptyString(input.completionId, "completionId") },
            });
            if (!row) return false;
            const current = row as WorkflowCompletionRow;
            if (
                current.status !== "leased"
                || current.leaseOwner !== requireNonEmptyString(input.owner, "owner")
                || current.leaseToken !== requireNonEmptyString(input.leaseToken, "leaseToken")
                || !current.leaseExpiresAt
                || current.leaseExpiresAt.getTime() <= now.getTime()
            ) return false;
            if (current.attempts >= current.maxAttempts) {
                const terminal = await tx.workflowCompletion.updateMany({
                    where: {
                        id: current.id,
                        status: "leased",
                        leaseOwner: current.leaseOwner,
                        leaseToken: current.leaseToken,
                        leaseExpiresAt: { gt: now },
                    },
                    data: {
                        status: "dead_letter",
                        lastError: error ?? "Workflow completion exceeded maximum delivery attempts.",
                        leaseOwner: null,
                        leaseToken: null,
                        leaseExpiresAt: null,
                    },
                });
                return terminal.count === 1;
            }
            const updated = await tx.workflowCompletion.updateMany({
                where: {
                    id: current.id,
                    status: "leased",
                    leaseOwner: current.leaseOwner,
                    leaseToken: current.leaseToken,
                    leaseExpiresAt: { gt: now },
                },
                data: {
                    status: "queued",
                    availableAt: requestedAt,
                    lastError: error,
                    leaseOwner: null,
                    leaseToken: null,
                    leaseExpiresAt: null,
                },
            });
            return updated.count === 1;
        });
    }
    async deadLetterWorkflowCompletion(
        input: DeadLetterWorkflowCompletionInput,
    ): Promise<boolean> {
        const now = input.now ?? new Date();
        assertValidDate(now, "now");
        const error = requireNonEmptyString(input.error, "error");
        const updated = await this.prisma.workflowCompletion.updateMany({
            where: {
                id: requireNonEmptyString(input.completionId, "completionId"),
                status: "leased",
                leaseOwner: requireNonEmptyString(input.owner, "owner"),
                leaseToken: requireNonEmptyString(input.leaseToken, "leaseToken"),
                leaseExpiresAt: { gt: now },
            },
            data: {
                status: "dead_letter",
                lastError: error,
                leaseOwner: null,
                leaseToken: null,
                leaseExpiresAt: null,
            },
        });
        return updated.count === 1;
    }


    async markResumeRequired(input: MarkResumeRequiredInput): Promise<boolean> {
        const now = input.now ?? new Date();
        assertValidDate(now, "now");
        const runLease = normalizeRunLease(input.runLease);
        const run = await this.prisma.workflowRun.findUnique({
            where: { id: runLease.runId },
        });
        if (!run || isTerminalRunStatus(run.status)) {
            return false;
        }
        if (!hasCurrentRunLease(run as WorkflowRunRow, runLease, now)) {
            return false;
        }
        const updated = await this.prisma.workflowRun.updateMany({
            where: {
                id: runLease.runId,
                status: run.status,
                runLeaseOwner: runLease.owner,
                runLeaseToken: runLease.leaseToken,
                runLeaseExpiresAt: { gt: now },
            },
            data: { resumeRequired: true },
        });
        if (updated.count === 1 && input.reason) {
            this.logger?.warn("workflow.run.resume_required", {
                runId: runLease.runId,
                reason: input.reason,
            });
        }
        return updated.count === 1;
    }

    async listRunsForRecovery(
        input: RecoveryRunsInput = {},
    ): Promise<readonly WorkflowEnvelope[]> {
        const limit = input.limit === undefined ? 100 : input.limit;
        if (!Number.isSafeInteger(limit) || limit < 1) {
            throw invalidState("Recovery limit must be a positive integer.");
        }
        const rows = await this.prisma.workflowRun.findMany({
            where: {
                status: { in: ["queued", "running", "waiting"] },
            },
            orderBy: [
                { updatedAt: "asc" },
                { id: "asc" },
            ],
            take: Math.max(limit * 4, limit),
        });
        const recovered: WorkflowEnvelope[] = [];
        for (const raw of rows) {
            const row = raw as WorkflowRunRow;
            const parsed = parseJson(row.stateJson, `Workflow run ${row.id} state`);
            const marker = isWorkflowEnvelopeMarker(parsed, row.id);
            if (!marker && !(
                row.resumeRequired
                && RECOVERABLE_RUN_STATUSES.includes(
                    row.status as (typeof RECOVERABLE_RUN_STATUSES)[number],
                )
            )) {
                continue;
            }
            recovered.push(toEnvelope(row));
            if (recovered.length >= limit) {
                break;
            }
        }
        return recovered;
    }
}

type PrismaOptions = {
    prisma: PrismaClient;
    logger?: LoggerPort;
    actionRetryPolicies?: Readonly<Record<string, RetryPolicy>>;
};

type WorkflowRunRow = {
    id: string;
    stateJson: string;
    kernelRevision: number;
    status: string;
    resumeRequired: boolean;
    definitionKey: string;
    definitionVersion: string;
    manifestHash: string;
    idempotencyKey: string | null;
    inputSnapshotJson: string;
    productRunJson: string;
    runLeaseOwner: string | null;
    runLeaseToken: string | null;
    runLeaseExpiresAt: Date | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
};
type ActivityJobRow = {
    id: string;
    runId: string | null;
    stepId: string | null;
    workflowRunId: string | null;
    workflowKernelRevision: number | null;
    kind: string;
    status: string;
    payloadJson: string | null;
    resultJson: string | null;
    idempotencyKey: string;
    attempts: number;
    maxAttempts: number;
    leaseOwner: string | null;
    leaseToken: string | null;
    leaseExpiresAt: Date | null;
    nextAttemptAt: Date | null;
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: Date;
    updatedAt: Date;
};

type WorkflowCompletionRow = {
    id: string;
    workflowRunId: string;
    jobId: string;
    activityKey: string;
    receipt: string;
    reference: string;
    fingerprint: string;
    completionJson: string;
    status: string;
    attempts: number;
    maxAttempts: number;
    availableAt: Date;
    leaseOwner: string | null;
    leaseToken: string | null;
    leaseExpiresAt: Date | null;
    lastError: string | null;
    createdAt: Date;
    updatedAt: Date;
};

function isPrismaOptions(
    input: PrismaClient | PrismaOptions,
): input is PrismaOptions {
    return typeof input === "object" && input !== null && "prisma" in input;
}

function normalizeEnvelopeInput(input: CreateWorkflowEnvelopeInput): {
    runId: string;
    idempotencyKey: string | null;
    definition: WorkflowDefinitionReference;
    inputSnapshot: JsonValue;
    productRun: JsonValue;
    createdAt: Date;
} {
    if (!input || typeof input !== "object") {
        throw invalidState("Workflow envelope input must be an object.");
    }
    const runId = requireNonEmptyString(input.runId, "runId");
    const idempotencyKey = input.idempotencyKey == null
        ? null
        : requireNonEmptyString(input.idempotencyKey, "idempotencyKey");
    const definition = normalizeDefinition(input.definition);
    assertJsonValue(input.inputSnapshot);
    assertJsonValue(input.productRun);
    const createdAt = input.createdAt === undefined
        ? new Date()
        : parseIsoDate(input.createdAt, "createdAt");
    return {
        runId,
        idempotencyKey,
        definition,
        inputSnapshot: structuredClone(input.inputSnapshot),
        productRun: structuredClone(input.productRun),
        createdAt,
    };
}

function normalizeDefinition(
    definition: WorkflowDefinitionReference,
): WorkflowDefinitionReference {
    if (!definition || typeof definition !== "object") {
        throw invalidState("Workflow definition must be an object.");
    }
    return {
        key: requireNonEmptyString(definition.key, "definition.key"),
        version: requireNonEmptyString(definition.version, "definition.version"),
        manifestHash: requireNonEmptyString(
            definition.manifestHash,
            "definition.manifestHash",
        ),
    };
}

function normalizeActivityRequest(request: ActivityExecutionRequest): {
    runId: string;
    activity: ActivityIdentity;
    reference: string;
    fingerprint: string;
    input: JsonValue;
    options: ActivityExecutionRequest["options"];
    idempotencyKey: string;
} {
    if (!request || typeof request !== "object") {
        throw invalidState("Activity request must be an object.");
    }
    if (!request.context || typeof request.context !== "object") {
        throw invalidState("Activity request context is required.");
    }
    const context = request.context;
    const activity = normalizeActivityIdentity(context.activity);
    const options = normalizeActivityOptions(request.options);
    assertJsonValue(request.input);
    const reference = requireNonEmptyString(request.reference, "reference");
    const fingerprint = requireNonEmptyString(
        context.activity.fingerprint,
        "activity.fingerprint",
    );
    return {
        runId: requireNonEmptyString(context.runId, "context.runId"),
        activity,
        reference,
        fingerprint,
        input: structuredClone(request.input),
        options,
        idempotencyKey: requireNonEmptyString(
            context.idempotencyKey,
            "context.idempotencyKey",
        ),
    };
}

function normalizeActivityIdentity(value: ActivityIdentity): ActivityIdentity {
    if (!value || typeof value !== "object") {
        throw invalidState("Activity identity must be an object.");
    }
    const seq = value.seq;
    if (!Number.isSafeInteger(seq) || seq < 0) {
        throw invalidState("Activity identity seq must be a non-negative integer.");
    }
    return {
        key: requireNonEmptyString(value.key, "activity.key"),
        path: requireNonEmptyString(value.path, "activity.path"),
        seq,
        kind: requireNonEmptyString(value.kind, "activity.kind"),
        fingerprint: requireNonEmptyString(value.fingerprint, "activity.fingerprint"),
    };
}

function normalizeActivityOptions(
    options: ActivityExecutionRequest["options"],
): ActivityExecutionRequest["options"] {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
        throw invalidState("Activity options must be an object.");
    }
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(options)) {
        if (value === undefined) {
            continue;
        }
        try {
            assertJsonValue(value);
        } catch (error) {
            throw serializationError(`Activity option ${key} is not JSON-safe.`, error);
        }
        result[key] = structuredClone(value);
    }
    if ("timeoutMs" in result) {
        const timeoutMs = result.timeoutMs;
        if (
            typeof timeoutMs !== "number"
            || !Number.isSafeInteger(timeoutMs)
            || timeoutMs < 0
        ) {
            throw invalidState("Activity option timeoutMs must be a non-negative integer.");
        }
    }
    if ("key" in result && typeof result.key !== "string") {
        throw invalidState("Activity option key must be a string.");
    }
    return result as ActivityExecutionRequest["options"];
}

function existingActionResult(
    row: ActivityJobRow,
    request: {
        runId: string;
        activity: ActivityIdentity;
        reference: string;
        fingerprint: string;
        input: JsonValue;
        options: ActivityExecutionRequest["options"];
        idempotencyKey: string;
    },
    identityJson: string,
): DeferredActivityStartResult {
    if (row.kind !== ACTIVITY_KIND || row.workflowRunId !== request.runId) {
        throw new WorkflowHostConflictError(
            `Idempotency key ${request.idempotencyKey} belongs to another Job.`,
        );
    }
    if (!row.payloadJson) {
        throw serializationError(`Activity Job ${row.id} has no payload.`);
    }
    const payload = parseActivityPayload(row.payloadJson, row.id);
    if (activityIdentityJson(payload) !== identityJson) {
        throw new WorkflowHostConflictError(
            `Activity idempotency key ${request.idempotencyKey} was reused with different identity.`,
        );
    }
    if (!VALID_JOB_STATUSES.includes(row.status as WorkflowJobStatus)) {
        throw invalidState(`Activity Job ${row.id} has unknown status ${row.status}.`);
    }
    if (row.status === "succeeded") {
        const result = row.resultJson === null
            ? null
            : decodeJson(row.resultJson, `Activity Job ${row.id} result`);
        return { status: "completed", result };
    }
    if (row.status === "failed_terminal" || row.status === "cancelled") {
        // Terminal failures are represented by the durable completion row. A
        // replaying Kernel still needs the same receipt to consume that result.
        return {
            status: "pending",
            receipt: row.id,
            reason: "workflow-activity",
        };
    }
    return {
        status: "pending",
        receipt: row.id,
        reason: "workflow-activity",
    };
}

function parseActivityPayload(
    payloadJson: string | null,
    jobId: string,
): WorkflowActivityJobPayload {
    if (!payloadJson) {
        throw serializationError(`Activity Job ${jobId} has no payload.`);
    }
    const parsed = parseJson(payloadJson, `Activity Job ${jobId} payload`);
    if (!isRecord(parsed)) {
        throw serializationError(`Activity Job ${jobId} payload must be an object.`);
    }
    const activityValue = parsed.activity;
    if (!isRecord(activityValue)) {
        throw serializationError(`Activity Job ${jobId} activity must be an object.`);
    }
    const activity = normalizeActivityIdentity(activityValue as ActivityIdentity);
    const input = parsed.input;
    assertJsonValue(input);
    const optionsValue = parsed.options;
    if (!isRecord(optionsValue)) {
        throw serializationError(`Activity Job ${jobId} options must be an object.`);
    }
    const options = normalizeActivityOptions(optionsValue as ActivityExecutionRequest["options"]);
    const runId = requireNonEmptyString(parsed.runId, `${jobId}.runId`);
    const reference = requireNonEmptyString(parsed.reference, `${jobId}.reference`);
    const idempotencyKey = requireNonEmptyString(
        parsed.idempotencyKey,
        `${jobId}.idempotencyKey`,
    );
    const retryPolicy = parsed.retryPolicy === undefined
        ? undefined
        : retryPolicySchema.parse(parsed.retryPolicy);
    return {
        runId,
        activity,
        reference,
        input: structuredClone(input),
        options,
        idempotencyKey,
        ...(retryPolicy === undefined ? {} : { retryPolicy }),
    };

}
function activityIdentityJson(
    payload: Pick<WorkflowActivityJobPayload, "runId" | "activity" | "reference" | "input" | "options" | "idempotencyKey" | "retryPolicy">,
): string {
    return canonicalJson({
        runId: payload.runId,
        activity: payload.activity,
        reference: payload.reference,
        fingerprint: payload.activity.fingerprint,
        input: payload.input,
        options: payload.options,
        idempotencyKey: payload.idempotencyKey,
        retryPolicy: payload.retryPolicy ?? null,
    });
}
function toActivityJobClaim(
    row: ActivityJobRow,
    payload: WorkflowActivityJobPayload,
    owner: string,
    leaseToken: string,
): WorkflowActivityJobClaim {
    if (!row.workflowRunId) {
        throw invalidState(`Activity Job ${row.id} has no Workflow run.`);
    }
    if (row.workflowKernelRevision === null) {
        throw invalidState(`Activity Job ${row.id} has no claimed Kernel revision.`);
    }
    return {
        id: row.id,
        workflowRunId: row.workflowRunId,
        kind: ACTIVITY_KIND,
        status: "leased",
        payload,
        kernelRevision: row.workflowKernelRevision,
        attempts: row.attempts,
        maxAttempts: row.maxAttempts,
        leaseOwner: owner,
        leaseToken,
        leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

function validateActivityTerminalResult(result: ActivityJobTerminalResult): void {
    if (!result || typeof result !== "object") {
        throw invalidState("Activity terminal result must be an object.");
    }
    if (!["succeeded", "retry_wait", "failed_terminal", "cancelled"].includes(result.status)) {
        throw invalidState(`Unknown Activity Job result status ${result.status}.`);
    }
    if (result.status === "retry_wait") {
        if (result.retryDelayMs !== undefined) normalizeRetryDelay(result.retryDelayMs);
    } else if (result.retryDelayMs !== undefined) {
        throw invalidState("retryDelayMs is only valid for retry_wait.");
    }
    if (result.result !== undefined) assertJsonValue(result.result);
    if (result.error !== undefined && result.error !== null && typeof result.error !== "string") {
        throw invalidState("Activity error must be a string or null.");
    }
    if (result.errorCode !== undefined && result.errorCode !== null && typeof result.errorCode !== "string") {
        throw invalidState("Activity errorCode must be a string or null.");
    }
}

function validateCompletionForJob(
    result: ActivityJobTerminalResult,
    completion: DeferredActivityCompletionInput | undefined,
    payload: WorkflowActivityJobPayload,
    jobId: string,
): DeferredActivityCompletionInput | null {
    if (result.status === "retry_wait") {
        if (completion !== undefined) throw invalidState("retry_wait must not create a Workflow completion.");
        return null;
    }
    if (!completion) throw invalidState("Terminal Activity result requires a Workflow completion.");
    if (completion.activityKey !== payload.activity.key
        || completion.receipt !== jobId
        || completion.reference !== payload.reference
        || completion.fingerprint !== payload.activity.fingerprint) {
        throw new WorkflowHostConflictError(`Activity completion identity does not match Job ${jobId}.`);
    }
    const expectedStatus = result.status === "succeeded"
        ? "completed" : result.status === "failed_terminal" ? "failed" : "cancelled";
    if (completion.status !== expectedStatus) {
        throw new WorkflowHostConflictError(
            `Activity completion status ${completion.status} does not match Job status ${result.status}.`,
        );
    }
    const hasResult = Object.prototype.hasOwnProperty.call(completion, "result");
    const hasError = Object.prototype.hasOwnProperty.call(completion, "error");
    if (completion.status === "completed") {
        if (!hasResult || completion.result === undefined || hasError) {
            throw invalidState("Completed Activity completion requires result and forbids error.");
        }
        if (result.result === undefined || canonicalJson(result.result) !== canonicalJson(completion.result)) {
            throw new WorkflowHostConflictError(`Activity completion result does not match succeeded Job ${jobId}.`);
        }
        if (result.error !== undefined && result.error !== null) {
            throw invalidState("Succeeded Activity result must not contain an error.");
        }
    } else if (completion.status === "failed") {
        if (!hasError || typeof completion.error !== "string" || completion.error.trim().length === 0 || hasResult) {
            throw invalidState("Failed Activity completion requires error and forbids result.");
        }
        if ((result.error ?? undefined) !== completion.error) {
            throw new WorkflowHostConflictError(`Activity completion error does not match terminal Job ${jobId}.`);
        }
    } else if (hasResult || hasError) {
        throw invalidState("Cancelled Activity completion forbids result and error.");
    }
    if (completion.result !== undefined) assertJsonValue(completion.result);
    return structuredClone(completion);
}

function toCompletion(row: WorkflowCompletionRow): WorkflowCompletion {
    if (!VALID_COMPLETION_STATUSES.includes(row.status as (typeof VALID_COMPLETION_STATUSES)[number])) {
        throw invalidState(`Workflow completion ${row.id} has unknown status ${row.status}.`);
    }
    const parsed = parseJson(
        row.completionJson,
        `Workflow completion ${row.id} payload`,
    );
    if (!isRecord(parsed)) {
        throw serializationError(`Workflow completion ${row.id} payload must be an object.`);
    }
    const completion = normalizeCompletionJson(parsed, row.id);
    if (
        completion.activityKey !== row.activityKey
        || completion.receipt !== row.receipt
        || completion.reference !== row.reference
        || completion.fingerprint !== row.fingerprint
    ) {
        throw serializationError(
            `Workflow completion ${row.id} projection does not match its payload.`,
        );
    }
    return {
        id: row.id,
        workflowRunId: row.workflowRunId,
        jobId: row.jobId,
        activityKey: row.activityKey,
        receipt: row.receipt,
        reference: row.reference,
        fingerprint: row.fingerprint,
        completion,
        status: row.status as WorkflowCompletion["status"],
        attempts: row.attempts,
        maxAttempts: row.maxAttempts,
        availableAt: row.availableAt.toISOString(),
        leaseOwner: row.leaseOwner,
        leaseToken: row.leaseToken,
        leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
        lastError: row.lastError,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

function normalizeCompletionJson(
    value: Record<string, unknown>,
    id: string,
): DeferredActivityCompletionInput {
    const status = value.status;
    if (status !== "completed" && status !== "failed" && status !== "cancelled") {
        throw serializationError(`Workflow completion ${id} has invalid status.`);
    }
    const activityKey = requireNonEmptyString(value.activityKey, `${id}.activityKey`);
    const receipt = requireNonEmptyString(value.receipt, `${id}.receipt`);
    const reference = requireNonEmptyString(value.reference, `${id}.reference`);
    const fingerprint = requireNonEmptyString(value.fingerprint, `${id}.fingerprint`);
    if (value.result !== undefined) {
        assertJsonValue(value.result);
    }
    if (value.error !== undefined && typeof value.error !== "string") {
        throw serializationError(`Workflow completion ${id} has invalid error.`);
    }
    return {
        activityKey,
        receipt,
        reference,
        fingerprint,
        status,
        ...(value.result === undefined ? {} : { result: structuredClone(value.result) }),
        ...(value.error === undefined ? {} : { error: value.error as string }),
    };
}

function toEnvelope(row: WorkflowRunRow): WorkflowEnvelope {
    const state = parseJson(row.stateJson, `Workflow run ${row.id} state`);
    if (isWorkflowEnvelopeMarker(state, row.id)) {
        if (row.status !== "queued" && !VALID_RUN_STATUSES.includes(row.status as WorkflowRunStatus)) {
            throw invalidState(`Workflow run ${row.id} has invalid status ${row.status}.`);
        }
    } else {
        assertKernelStateProjection(row, state);
    }
    const inputSnapshot = decodeJson(
        row.inputSnapshotJson,
        `Workflow run ${row.id} input snapshot`,
    );
    const productRun = decodeJson(
        row.productRunJson,
        `Workflow run ${row.id} product snapshot`,
    );
    if (!VALID_RUN_STATUSES.includes(row.status as WorkflowRunStatus)) {
        throw invalidState(`Workflow run ${row.id} has invalid status ${row.status}.`);
    }
    return {
        runId: row.id,
        idempotencyKey: row.idempotencyKey,
        definition: {
            key: row.definitionKey,
            version: row.definitionVersion,
            manifestHash: row.manifestHash,
        },
        inputSnapshot,
        productRun,
        status: row.status as WorkflowRunStatus,
        resumeRequired: row.resumeRequired,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        startedAt: row.startedAt?.toISOString() ?? null,
        finishedAt: row.finishedAt?.toISOString() ?? null,
    };
}

function assertEnvelopeIdentity(
    row: WorkflowRunRow,
    input: {
        runId: string;
        idempotencyKey: string | null;
        definition: WorkflowDefinitionReference;
    },
    inputSnapshotJson: string,
    productRunJson: string,
): WorkflowEnvelope {
    if (row.idempotencyKey !== input.idempotencyKey) {
        throw new WorkflowHostConflictError(
            `Idempotency key ${input.idempotencyKey ?? "<none>"} is already bound to another envelope.`,
        );
    }
    const existingInput = canonicalJson(
        decodeJson(row.inputSnapshotJson, `Workflow run ${row.id} input snapshot`),
    );
    const existingProduct = canonicalJson(
        decodeJson(row.productRunJson, `Workflow run ${row.id} product snapshot`),
    );
    if (
        row.definitionKey !== input.definition.key
        || row.definitionVersion !== input.definition.version
        || row.manifestHash !== input.definition.manifestHash
        || existingInput !== inputSnapshotJson
        || existingProduct !== productRunJson
    ) {
        throw new WorkflowHostConflictError(
            `Idempotency key ${row.idempotencyKey} was reused with a different Workflow envelope identity.`,
        );
    }
    return toEnvelope(row);
}

function rejectedActivityResult(status: string | null | undefined): CompleteActivityResult {
    const jobStatus = status !== undefined && status !== null
        && VALID_JOB_STATUSES.includes(status as WorkflowJobStatus)
        ? status as WorkflowJobStatus
        : "queued";
    return {
        accepted: false,
        jobStatus,
        completion: null,
    };
}

function sameCompletionIdentity(
    left: DeferredActivityCompletionInput,
    right: DeferredActivityCompletionInput,
): boolean {
    return canonicalJson(left) === canonicalJson(right);
}

function assertKernelStateProjection(row: WorkflowRunRow, state: unknown): void {
    if (!isRecord(state)) {
        throw serializationError(`Workflow run ${row.id} state must be an object.`);
    }
    if (state.runId !== row.id) {
        throw serializationError(`Workflow run ${row.id} state runId does not match its row.`);
    }
    if (!isRecord(state.definition)) {
        throw serializationError(`Workflow run ${row.id} state definition is invalid.`);
    }
    if (
        state.definition.key !== row.definitionKey
        || state.definition.version !== row.definitionVersion
        || state.definition.manifestHash !== row.manifestHash
    ) {
        throw serializationError(`Workflow run ${row.id} definition projection is inconsistent.`);
    }
    if (state.status !== row.status) {
        throw serializationError(`Workflow run ${row.id} status projection is inconsistent.`);
    }
}

function previousRunLeaseGuard(row: WorkflowRunRow): Record<string, unknown> {
    if (row.runLeaseOwner === null && row.runLeaseToken === null && row.runLeaseExpiresAt === null) {
        return {
            runLeaseOwner: null,
            runLeaseToken: null,
            runLeaseExpiresAt: null,
        };
    }
    return {
        runLeaseOwner: row.runLeaseOwner,
        runLeaseToken: row.runLeaseToken,
        runLeaseExpiresAt: row.runLeaseExpiresAt,
    };
}

function previousJobLeaseGuard(row: ActivityJobRow): Record<string, unknown> {
    if (row.status !== "leased") {
        return {
            leaseOwner: null,
            leaseToken: null,
            leaseExpiresAt: null,
        };
    }
    return {
        leaseOwner: row.leaseOwner,
        leaseToken: row.leaseToken,
        leaseExpiresAt: row.leaseExpiresAt,
    };
}

function previousCompletionLeaseGuard(row: WorkflowCompletionRow): Record<string, unknown> {
    if (row.status !== "leased") {
        return {
            leaseOwner: null,
            leaseToken: null,
            leaseExpiresAt: null,
        };
    }
    return {
        leaseOwner: row.leaseOwner,
        leaseToken: row.leaseToken,
        leaseExpiresAt: row.leaseExpiresAt,
    };
}

function normalizeActivityJobLease(input: ActivityJobLease): ActivityJobLease {
    return {
        jobId: requireNonEmptyString(input.jobId, "jobLease.jobId"),
        leaseToken: requireNonEmptyString(input.leaseToken, "jobLease.leaseToken"),
        owner: requireNonEmptyString(input.owner, "jobLease.owner"),
        ...(input.leaseExpiresAt === undefined
            ? {}
            : { leaseExpiresAt: parseIsoDate(input.leaseExpiresAt, "jobLease.leaseExpiresAt").toISOString() }),
    };
}

function normalizeRunLease(input: WorkflowRunLease): WorkflowRunLease {
    return {
        runId: requireNonEmptyString(input.runId, "runLease.runId"),
        leaseToken: requireNonEmptyString(input.leaseToken, "runLease.leaseToken"),
        owner: requireNonEmptyString(input.owner, "runLease.owner"),
        ...(input.leaseExpiresAt === undefined
            ? {}
            : { leaseExpiresAt: parseIsoDate(input.leaseExpiresAt, "runLease.leaseExpiresAt").toISOString() }),
    };
}

function activityCompletionForState(
    state: unknown,
    completion: DeferredActivityCompletionInput,
    kernelRevision: number,
): boolean {
    if (!isRecord(state) || state.revision !== kernelRevision) return false;
    const records = state.activityCompletions;
    if (!Array.isArray(records)) return false;
    const incomingFingerprint = fingerprint({
        activityKey: completion.activityKey,
        receipt: completion.receipt,
        reference: completion.reference,
        fingerprint: completion.fingerprint,
        status: completion.status,
        hasResult: Object.prototype.hasOwnProperty.call(completion, "result"),
        result: completion.result === undefined ? null : completion.result,
        hasError: Object.prototype.hasOwnProperty.call(completion, "error"),
        error: completion.error === undefined ? null : completion.error,
    });
    return records.some((record) => {
        if (!isRecord(record)) return false;
        if (
            record.key !== completion.activityKey
            || record.receipt !== completion.receipt
            || record.reference !== completion.reference
            || record.fingerprint !== completion.fingerprint
            || record.status !== completion.status
        ) return false;
        if (typeof record.completionFingerprint === "string") {
            return record.completionFingerprint === incomingFingerprint;
        }
        const encodedResult = record.result;
        const result = isRecord(encodedResult) && encodedResult.kind === "inline"
            ? encodedResult.value
            : encodedResult;
        return fingerprint({
            activityKey: record.key,
            receipt: record.receipt,
            reference: record.reference,
            fingerprint: record.fingerprint,
            status: record.status,
            hasResult: Object.prototype.hasOwnProperty.call(record, "result"),
            result: result === undefined ? null : result,
            hasError: Object.prototype.hasOwnProperty.call(record, "error"),
            error: record.error === undefined ? null : record.error,
        }) === incomingFingerprint;
    });
}


function pendingActivityForState(
    state: unknown,
    payload: WorkflowActivityJobPayload,
    receipt?: string,
): Record<string, unknown> | null {
    if (!isRecord(state)) return null;
    const pending = state.pendingActivities;
    if (!Array.isArray(pending)) return null;
    const candidate = pending.find((entry) => isRecord(entry)
        && entry.key === payload.activity.key
        && entry.path === payload.activity.path
        && entry.seq === payload.activity.seq
        && entry.kind === payload.activity.kind
        && entry.fingerprint === payload.activity.fingerprint
        && entry.reference === payload.reference
        && (receipt === undefined || entry.receipt === receipt));
    return isRecord(candidate) ? candidate : null;
}

function hasPendingActivity(
    state: unknown,
    payload: WorkflowActivityJobPayload,
    receipt?: string,
): boolean {
    return pendingActivityForState(state, payload, receipt) !== null;
}

async function appendWorkflowRunQueuedEvent(
    tx: Prisma.TransactionClient,
    input: {
        workflowRunId: string;
        productRun: JsonValue;
    },
): Promise<void> {
    const payload = workflowRunQueuedEventPayload(input.workflowRunId, input.productRun);
    const payloadJson = canonicalJson(payload);
    const idempotencyKey = `workflow-run:${input.workflowRunId}:queued`;
    const existing = await tx.domainEvent.findFirst({
        where: {
            workflowRunId: input.workflowRunId,
            idempotencyKey,
        },
    });
    if (existing) {
        assertSameWorkflowRunQueuedEvent(existing, payloadJson, idempotencyKey);
        return;
    }
    const data = {
        eventId: randomUUID(),
        type: "run.queued.v1",
        version: "v1",
        payloadJson,
        aggregateType: "WorkflowRun",
        aggregateId: input.workflowRunId,
        runId: null,
        workflowRunId: input.workflowRunId,
        idempotencyKey,
    };
    try {
        await tx.domainEvent.create({ data });
    } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        const winner = await tx.domainEvent.findFirst({
            where: {
                workflowRunId: input.workflowRunId,
                idempotencyKey,
            },
        });
        if (!winner) throw error;
        assertSameWorkflowRunQueuedEvent(winner, payloadJson, idempotencyKey);
    }
}

function workflowRunQueuedEventPayload(
    workflowRunId: string,
    productRun: JsonValue,
): { runId: string; sourceId?: string; triggerKind?: string } {
    const payload: { runId: string; sourceId?: string; triggerKind?: string } = {
        runId: workflowRunId,
    };
    if (!isRecord(productRun)) return payload;
    if (typeof productRun.sourceId === "string" && productRun.sourceId.length > 0) {
        payload.sourceId = productRun.sourceId;
    }
    if (typeof productRun.triggerKind === "string" && productRun.triggerKind.length > 0) {
        payload.triggerKind = productRun.triggerKind;
    }
    return payload;
}

function assertSameWorkflowRunQueuedEvent(
    existing: {
        type: string;
        version: string;
        payloadJson: string;
        aggregateType: string | null;
        aggregateId: string | null;
        runId: string | null;
        workflowRunId: string | null;
    },
    payloadJson: string,
    idempotencyKey: string,
): void {
    if (
        existing.type !== "run.queued.v1"
        || existing.version !== "v1"
        || existing.payloadJson !== payloadJson
        || existing.aggregateType !== "WorkflowRun"
        || existing.aggregateId !== existing.workflowRunId
        || existing.runId !== null
    ) {
        throw new WorkflowHostConflictError(
            `Workflow domain event ${idempotencyKey} conflicts with the durable Workflow Run queued event.`,
        );
    }
}

async function appendActivityLifecycleEvent(
    tx: Prisma.TransactionClient,
    input: {
        workflowRunId: string;
        jobId: string;
        attempt: number;
        owner: string;
        expiresAt: Date | null;
        status: string;
        error?: string;
        idempotencyKey: string;
    },
): Promise<void> {
    const payload = {
        workflowRunId: input.workflowRunId,
        jobId: input.jobId,
        attempt: input.attempt,
        owner: input.owner,
        leaseExpiresAt: input.expiresAt?.toISOString() ?? null,
        status: input.status,
        ...(input.error === undefined ? {} : { error: input.error }),
    };
    try {
        await tx.domainEvent.create({
            data: {
                eventId: randomUUID(),
                type: `workflow.activity.${input.status}.v1`,
                version: "v1",
                payloadJson: canonicalJson(payload),
                aggregateType: "WorkflowActivityJob",
                aggregateId: input.jobId,
                runId: null,
                workflowRunId: input.workflowRunId,
                idempotencyKey: input.idempotencyKey,
            },
        });
    } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
    }
}
function assertCurrentRunLease(
    row: WorkflowRunRow,
    lease: WorkflowRunLease,
    now: Date,
): void {
    if (!hasCurrentRunLease(row, lease, now)) {
        throw new WorkflowHostError(
            "lease_lost",
            `Workflow run lease ${lease.runId} is no longer current.`,
        );
    }
}

function hasCurrentRunLease(
    row: WorkflowRunRow,
    lease: WorkflowRunLease,
    now: Date,
): boolean {
    return row.id === lease.runId
        && row.runLeaseOwner === lease.owner
        && row.runLeaseToken === lease.leaseToken
        && row.runLeaseExpiresAt !== null
        && row.runLeaseExpiresAt.getTime() > now.getTime();
}

function isTerminalRunStatus(status: string): boolean {
    return (TERMINAL_RUN_STATUSES as readonly string[]).includes(status);
}

function encodeJson(value: unknown, label: string): string {
    try {
        assertJsonValue(value);
        return canonicalJson(value);
    } catch (error) {
        throw serializationError(`${label} is not JSON-safe.`, error);
    }
}

function decodeJson(value: string, label: string): JsonValue {
    const parsed = parseJson(value, label);
    try {
        assertJsonValue(parsed);
    } catch (error) {
        throw serializationError(`${label} is not a JSON value.`, error);
    }
    return structuredClone(parsed);
}

function parseJson(value: string, label: string): unknown {
    try {
        return JSON.parse(value) as unknown;
    } catch (error) {
        throw serializationError(`${label} contains invalid JSON.`, error);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, label: string): string {
    if (typeof value !== "string" || value.length === 0) {
        throw invalidState(`${label} must be a non-empty string.`);
    }
    return value;
}

function parseIsoDate(value: string, label: string): Date {
    if (typeof value !== "string") {
        throw invalidState(`${label} must be an ISO date string.`);
    }
    const date = new Date(value);
    assertValidDate(date, label);
    return date;
}

function assertValidDate(value: Date, label: string): void {
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
        throw invalidState(`${label} must be a valid date.`);
    }
}

function validateLeaseMs(value: number): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw invalidState("leaseMs must be a positive integer.");
    }
}

function normalizeRetryDelay(value: number | undefined): number {
    const delay = value ?? 30_000;
    if (!Number.isSafeInteger(delay) || delay < 0) {
        throw invalidState("retryDelayMs must be a non-negative integer.");
    }
    return delay;
}

function completionBackoffMs(attempt: number): number {
    const safeAttempt = Math.max(1, Math.min(10, Math.floor(attempt)));
    return Math.min(30_000, 1_000 * (2 ** (safeAttempt - 1)));
}

function invalidState(message: string): WorkflowHostError {
    return new WorkflowHostError("invalid_state", message);
}

function serializationError(message: string, cause?: unknown): WorkflowHostError {
    return new WorkflowHostError("serialization", message, cause === undefined ? undefined : { cause });
}

function isUniqueConstraintError(error: unknown): boolean {
    return isRecord(error) && error.code === "P2002";
}
