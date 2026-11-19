import { createHash } from "node:crypto";
import { type Artifact, type ArtifactRevision, type Prisma, type WorkflowRun } from "@prisma/client";
import { canonicalJson } from "@notnotype/nb-workflow";
import { WorkflowHostConflictError, type CreateWorkflowEnvelopeInput, type HostActionExecutionFence, type WorkflowEnvelope } from "@cosmos/application";
import {
    artifactSnapshotSchema, deepReadGenerationSchema, inputProjectionSchema, agentInvocationV2InputSchema,
    storyDeepReadRevisionDetailSchema, revisionSummarySchema,
    type ArtifactSnapshot, type InputProjection, type StoryDeepReadRevisionDetail,
} from "@cosmos/contracts";
import { PrismaCosmosRepositoryConnectorStateExport } from "./connector-state-export.js";
import { appendDomainEvent, assertWorkflowActionFence } from "./repository-internals.js";
import { deepReadSourceStatus } from "./story-deep-read-source-status.js";
import { createWorkflowEnvelopeInTransaction } from "../workflow-host-store/envelope-store.js";
import { toEnvelope } from "../workflow-host-store/internals-activity.js";

type RevisionDetail = StoryDeepReadRevisionDetail;
type ErrorCode = "conflict" | "not_found" | "invalid_configuration" | "malformed_payload" | "dependency_unavailable";
export class StoryDeepReadRepositoryError extends Error {
    readonly retryable: boolean;
    constructor(readonly code: ErrorCode, retryable = false) {
        super({ conflict: "Story deep read conflict", not_found: "Story deep read not found", invalid_configuration: "Story deep read configuration invalid",
            malformed_payload: "Story deep read data invalid", dependency_unavailable: "Story deep read storage temporarily unavailable" }[code]);
        this.name = "StoryDeepReadRepositoryError";
        this.retryable = code === "dependency_unavailable" && retryable;
    }
}
export interface EnqueueStoryDeepReadInput extends CreateWorkflowEnvelopeInput {
    storyId: string;
    requestHash: string;
}
export interface PublishStoryDeepReadRevisionInput {
    workflowRunId: string;
    fence: HostActionExecutionFence;
    headline: string;
    sections: unknown;
    producerVersion: string;
    provider: string;
    model: string;
    usage?: unknown;
    cost?: unknown;
}
class SlotRace extends Error {}
const kind = "story-deep-read";
const terminal = ["completed", "failed", "cancelled"];
function fail(code: ErrorCode, retryable = false): never { throw new StoryDeepReadRepositoryError(code, retryable); }
function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("malformed_payload");
    return value as Record<string, unknown>;
}
function snapshot(run: WorkflowRun): Record<string, unknown> {
    return checked(() => {
        const value = object(JSON.parse(run.inputSnapshotJson ?? "null"));
        if (value.kind !== kind || typeof value.storyId !== "string" || !value.storyId
            || typeof value.resolvedModelId !== "string" || !value.resolvedModelId) fail("malformed_payload");
        return value;
    });
}
function errorCode(error: unknown): string | undefined { return error instanceof Error && "code" in error ? String(error.code) : undefined; }
function competition(error: unknown): boolean {
    return error instanceof SlotRace || ["P2034", "P1008", "P1001", "P1017", "ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT"].includes(errorCode(error) ?? "")
        || (error instanceof Error && /SQLITE_(?:BUSY|LOCKED)|database (?:table )?is locked|write conflict|connection (?:closed|reset|refused|terminated)|server has closed the connection/i.test(error.message));
}
function permanentStorageFailure(error: unknown): never {
    if (error instanceof WorkflowHostConflictError || ["P2002", "P2003", "P2004"].includes(errorCode(error) ?? "")) fail("conflict");
    if (errorCode(error) === "invalid_state" || errorCode(error) === "serialization") fail("malformed_payload");
    if (error instanceof Error && error.name === "PrismaClientValidationError") fail("invalid_configuration");
    return fail("dependency_unavailable");
}
function artifactIdentityRace(error: unknown): boolean {
    if (errorCode(error) !== "P2002" || !(error instanceof Error) || !("meta" in error)) return false;
    const meta = error.meta;
    if (!meta || typeof meta !== "object" || !("modelName" in meta) || meta.modelName !== "Artifact" || !("target" in meta)) return false;
    return Array.isArray(meta.target) && meta.target.length === 2 && meta.target.includes("storyId") && meta.target.includes("kind");
}
const fenceFailures = new Set([
    "Workflow action fence Run identity mismatch.",
    "Workflow Run fence lost or Kernel revision changed.",
    "Workflow Activity Job fence lost.",
    "Workflow Activity identity changed under fence.",
]);
function checked<T>(parse: () => T): T {
    try { return parse(); } catch (error) {
        if (error instanceof StoryDeepReadRepositoryError) throw error;
        return fail("malformed_payload");
    }
}
async function safeStorage<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
        try { return await operation(); } catch (error) {
            if (error instanceof StoryDeepReadRepositoryError) throw error;
            if (!competition(error)) permanentStorageFailure(error);
            if (attempt === 2) fail("dependency_unavailable", true);
            await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 50 : 150));
        }
    }
    return fail("dependency_unavailable", true);
}
function envelope(row: WorkflowRun): WorkflowEnvelope {
    const { inputSnapshotJson, productRunJson } = row;
    if (inputSnapshotJson === null || productRunJson === null) fail("malformed_payload");
    return checked(() => toEnvelope({ ...row, inputSnapshotJson, productRunJson }));
}
function identity(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0 && value.length <= 200;
}
function validateReplayIdentity(input: EnqueueStoryDeepReadInput): void {
    if (!identity(input.storyId) || !identity(input.idempotencyKey)
        || !/^[a-f0-9]{64}$/.test(input.requestHash) || input.definition?.key !== "cosmos.story-deep-read"
        || input.definition.version !== "1" || !identity(input.definition.manifestHash)) fail("invalid_configuration");
}
function validateNewRun(input: EnqueueStoryDeepReadInput): void {
    try {
        if (!identity(input.runId)) fail("invalid_configuration");
        const frozen = object(input.inputSnapshot);
        if (frozen.kind !== kind || frozen.storyId !== input.storyId || !identity(frozen.resolvedModelId)) fail("invalid_configuration");
        inputProjectionSchema.parse(frozen.input);
        const invocation = agentInvocationV2InputSchema.parse({ modelId: frozen.resolvedModelId, messages: frozen.messages, budget: frozen.budget });
        if (invocation.budget.maxToolCalls !== 0 || invocation.budget.maxOutputTokens !== 6000) fail("invalid_configuration");
    } catch { fail("invalid_configuration"); }
}
function contentHash(detail: Pick<RevisionDetail, "headline" | "sections" | "input">): string {
    return createHash("sha256").update(canonicalJson({ headline: detail.headline, sections: detail.sections, input: detail.input })).digest("hex");
}

export class PrismaCosmosRepositoryStoryDeepRead extends PrismaCosmosRepositoryConnectorStateExport {
    async enqueueStoryDeepRead(value: EnqueueStoryDeepReadInput): Promise<{ run: WorkflowEnvelope; artifactId: string; reused: boolean }> {
        validateReplayIdentity(value);
        if (!value.idempotencyKey) fail("invalid_configuration");
        const input = { ...value, idempotencyKey: value.idempotencyKey };
        return safeStorage(async () => {
            try { return await this.prisma.$transaction((tx) => this.enqueueDeepReadTransaction(tx, input)); }
            catch (error) {
                // Re-read a committed winner only after the failed transaction has rolled back.
                if (errorCode(error) === "P2002") {
                    const winner = await this.deepReadReplay(this.prisma, input);
                    if (winner) return winner;
                    if (await this.prisma.workflowRun.findUnique({ where: { idempotencyKey: input.idempotencyKey } })) fail("conflict");
                    if (await this.prisma.workflowRun.findUnique({ where: { id: input.runId } })) fail("conflict");
                    fail("conflict");
                }
                throw error;
            }
        });
    }

    private async enqueueDeepReadTransaction(tx: Prisma.TransactionClient, input: EnqueueStoryDeepReadInput & { idempotencyKey: string }) {
        const replay = await this.deepReadReplay(tx, input);
        if (replay) return replay;
        if (await tx.workflowRun.findUnique({ where: { idempotencyKey: input.idempotencyKey } })) fail("conflict");
        validateNewRun(input);
        if (!await tx.story.findUnique({ where: { id: input.storyId } })) fail("not_found");
        if (await tx.storyReplacement.findFirst({ where: { storyId: input.storyId } })) fail("invalid_configuration");
        const artifact = await tx.artifact.upsert({
            where: { storyId_kind: { storyId: input.storyId, kind } }, create: { storyId: input.storyId, kind }, update: {},
        }).catch((error: unknown) => {
            // Only this constraint at the Artifact creation boundary is a retryable identity race.
            if (artifactIdentityRace(error)) throw new SlotRace();
            throw error;
        });
        if (artifact.activeRunId) {
            const active = await tx.workflowRun.findUnique({ where: { id: artifact.activeRunId } });
            if (active && !terminal.includes(active.status)) fail("conflict");
            const cleared = await tx.artifact.updateMany({ where: { id: artifact.id, activeRunId: artifact.activeRunId }, data: { activeRunId: null, activeStartedAt: null } });
            if (cleared.count !== 1) throw new SlotRace();
        }
        const run = await createWorkflowEnvelopeInTransaction(tx, input);
        const claimed = await tx.artifact.updateMany({ where: { id: artifact.id, activeRunId: null }, data: { activeRunId: run.runId, activeStartedAt: new Date(run.createdAt) } });
        if (claimed.count !== 1) throw new SlotRace();
        await tx.deepReadRequest.create({ data: { storyId: input.storyId, workflowRunId: run.runId, idempotencyKey: input.idempotencyKey, requestHash: input.requestHash } });
        return { run, artifactId: artifact.id, reused: false };
    }

    private async deepReadReplay(tx: Prisma.TransactionClient, input: EnqueueStoryDeepReadInput & { idempotencyKey: string }) {
        const receipt = await tx.deepReadRequest.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
        if (!receipt) return null;
        if (receipt.requestHash !== input.requestHash || receipt.storyId !== input.storyId) fail("conflict");
        const run = await tx.workflowRun.findUnique({ where: { id: receipt.workflowRunId } });
        if (!run || run.idempotencyKey !== input.idempotencyKey || run.definitionKey !== input.definition.key
            || run.definitionVersion !== input.definition.version || run.manifestHash !== input.definition.manifestHash) fail("conflict");
        if (snapshot(run).storyId !== input.storyId) fail("conflict");
        const artifact = await tx.artifact.findUnique({ where: { storyId_kind: { storyId: input.storyId, kind } } });
        if (!artifact) fail("conflict");
        return { run: envelope(run), artifactId: artifact.id, reused: true };
    }

    async publishStoryDeepReadRevision(input: PublishStoryDeepReadRevisionInput): Promise<RevisionDetail> {
        return safeStorage(async () => {
            try { return await this.prisma.$transaction((tx) => this.publishDeepReadTransaction(tx, input)); }
            catch (error) {
                if (error instanceof StoryDeepReadRepositoryError) throw error;
                if (errorCode(error) === "P2002") {
                    const winner = await this.prisma.artifactRevision.findUnique({ where: { workflowRunId: input.workflowRunId }, include: { artifact: true } });
                    if (winner) {
                        if (winner.artifact.kind !== kind) fail("conflict");
                        return this.replayDeepReadPublication(this.prisma, winner, winner.artifact.storyId, input);
                    }
                    fail("conflict");
                }
                throw error;
            }
        });
    }

    private async replayDeepReadPublication(tx: Prisma.TransactionClient, row: ArtifactRevision, storyId: string, input: PublishStoryDeepReadRevisionInput) {
        const existing = await this.deepReadDetail(tx, row, storyId);
        const proposed = checked(() => storyDeepReadRevisionDetailSchema.parse({ ...existing, headline: input.headline, sections: input.sections }));
        if (contentHash(proposed) !== row.contentHash) fail("conflict");
        return existing;
    }

    private async publishDeepReadTransaction(tx: Prisma.TransactionClient, input: PublishStoryDeepReadRevisionInput): Promise<RevisionDetail> {
        const existing = await tx.artifactRevision.findUnique({ where: { workflowRunId: input.workflowRunId }, include: { artifact: true } });
        if (existing) {
            if (existing.artifact.kind !== kind) fail("conflict");
            return this.replayDeepReadPublication(tx, existing, existing.artifact.storyId, input);
        }
        const run = await tx.workflowRun.findUnique({ where: { id: input.workflowRunId } });
        if (!run) fail("not_found");
        const frozen = snapshot(run);
        const storyId = String(frozen.storyId);
        const receipt = await tx.deepReadRequest.findUnique({ where: { workflowRunId: input.workflowRunId } });
        if (receipt?.storyId !== storyId || run.definitionKey !== "cosmos.story-deep-read" || run.definitionVersion !== "1") fail("conflict");
        const artifact = await tx.artifact.findUnique({ where: { storyId_kind: { storyId, kind } } });
        if (!artifact) fail("not_found");
        if (artifact.activeRunId !== input.workflowRunId) fail("conflict");
        try { await assertWorkflowActionFence(tx, input.fence, input.workflowRunId); }
        catch (error) {
            // The shared helper exposes fence rejection as these exact plain Errors.
            if (error instanceof Error && error.constructor === Error && fenceFailures.has(error.message)) fail("conflict");
            throw error;
        }
        const frozenInput = checked(() => inputProjectionSchema.parse(frozen.input));
        const maximum = await tx.artifactRevision.aggregate({ where: { artifactId: artifact.id }, _max: { revision: true } });
        const detail = checked(() => storyDeepReadRevisionDetailSchema.parse({
            artifactId: artifact.id, storyId, workflowRunId: input.workflowRunId, revision: (maximum._max.revision ?? 0) + 1,
            headline: input.headline, sections: input.sections, input: frozenInput, contentHash: "0".repeat(64),
            producer: "agent", producerVersion: input.producerVersion, provider: input.provider, model: input.model,
            ...(input.usage === undefined ? {} : { usage: input.usage }), ...(input.cost === undefined ? {} : { cost: input.cost }),
            createdAt: new Date().toISOString(), sourceStatus: "current",
        }));
        this.assertDeepReadEvidence(detail, frozenInput);
        detail.contentHash = contentHash(detail);
        const row = await tx.artifactRevision.create({ data: {
            artifactId: artifact.id, revision: detail.revision, workflowRunId: input.workflowRunId,
            headline: detail.headline, sectionsJson: JSON.stringify(detail.sections), inputJson: JSON.stringify(detail.input),
            contentHash: detail.contentHash, producer: detail.producer, producerVersion: detail.producerVersion, provider: detail.provider, model: detail.model,
            usageJson: detail.usage === undefined ? null : JSON.stringify(detail.usage), costJson: detail.cost === undefined ? null : JSON.stringify(detail.cost), createdAt: new Date(detail.createdAt),
        } });
        const cleared = await tx.artifact.updateMany({ where: { id: artifact.id, activeRunId: input.workflowRunId }, data: { activeRunId: null, activeStartedAt: null } });
        if (cleared.count !== 1) fail("conflict");
        await appendDomainEvent(tx, { type: "artifact.revision_published.v1", aggregateType: "Artifact", aggregateId: artifact.id,
            workflowRunId: input.workflowRunId, idempotencyKey: "artifact.publish@1", payload: { artifactId: artifact.id, storyId, revision: detail.revision, contentHash: detail.contentHash } });
        return this.deepReadDetail(tx, row, storyId);
    }

    private assertDeepReadEvidence(detail: RevisionDetail, frozen: InputProjection): void {
        for (const section of detail.sections) for (const evidence of section.evidence) {
            if (!frozen.sources.some((source) => !source.omitted && source.representationVersion !== null
                && Number.isSafeInteger(source.representationVersion) && source.representationVersion > 0 && source.blockIds.length > 0
                && source.entryId === evidence.entryId
                && source.entryRevisionId === evidence.entryRevisionId && source.representationVersion === evidence.representationVersion
                && (evidence.blockId === undefined || source.blockIds.includes(evidence.blockId)))) fail("malformed_payload");
        }
    }

    private async deepReadDetail(tx: Prisma.TransactionClient, row: ArtifactRevision, storyId: string): Promise<RevisionDetail> {
        const detail = checked(() => storyDeepReadRevisionDetailSchema.parse({
            artifactId: row.artifactId, storyId, workflowRunId: row.workflowRunId, revision: row.revision, headline: row.headline,
            sections: JSON.parse(row.sectionsJson), input: JSON.parse(row.inputJson), contentHash: row.contentHash,
            producer: row.producer, producerVersion: row.producerVersion, provider: row.provider, model: row.model,
            createdAt: row.createdAt.toISOString(), sourceStatus: "current",
            ...(row.usageJson === null ? {} : { usage: JSON.parse(row.usageJson) }), ...(row.costJson === null ? {} : { cost: JSON.parse(row.costJson) }),
        }));
        return { ...detail, sourceStatus: await deepReadSourceStatus(tx, detail.input) };
    }

    async findStoryDeepReadRequest(idempotencyKey: string): Promise<{ storyId: string; requestHash: string; run: WorkflowEnvelope } | null> {
        return safeStorage(async () => {
            const request = await this.prisma.deepReadRequest.findUnique({
                where: { idempotencyKey },
                select: { storyId: true, requestHash: true, workflowRunId: true },
            });
            if (!request) return null;
            const run = await this.prisma.workflowRun.findUnique({ where: { id: request.workflowRunId } });
            if (!run || run.idempotencyKey !== idempotencyKey || run.definitionKey !== "cosmos.story-deep-read" || run.definitionVersion !== "1") fail("conflict");
            return { storyId: request.storyId, requestHash: request.requestHash, run: envelope(run) };
        });
    }

    async getStoryDeepReadArtifact(storyId: string): Promise<ArtifactSnapshot | null> {
        return safeStorage(() => this.prisma.$transaction(async (tx) => {
            if (!await tx.story.findUnique({ where: { id: storyId }, select: { id: true } })) fail("not_found");
            const artifact = await tx.artifact.findUnique({ where: { storyId_kind: { storyId, kind } } });
            if (!artifact) return null;
            const rows = await tx.artifactRevision.findMany({ where: { artifactId: artifact.id }, orderBy: { revision: "desc" }, take: 50 });
            const details = await Promise.all(rows.map((row) => this.deepReadDetail(tx, row, storyId)));
            const generation = await this.deepReadActiveGeneration(tx, artifact);
            return checked(() => artifactSnapshotSchema.parse({ id: artifact.id, storyId, kind, generation,
                revisions: details.map(({ sections: _sections, input: _input, ...summary }) => revisionSummarySchema.parse(summary)), current: details[0] ?? null }));
        }));
    }

    private async deepReadActiveGeneration(tx: Prisma.TransactionClient, artifact: Artifact) {
        const active = artifact.activeRunId ? await tx.workflowRun.findUnique({ where: { id: artifact.activeRunId } }) : null;
        if (!active || terminal.includes(active.status)) return null;
        const frozen = snapshot(active);
        if (frozen.storyId !== artifact.storyId || active.definitionKey !== "cosmos.story-deep-read" || active.definitionVersion !== "1") fail("malformed_payload");
        if (!["queued", "running", "waiting"].includes(active.status)) fail("malformed_payload");
        return checked(() => deepReadGenerationSchema.parse({
            runId: active.id, storyId: artifact.storyId, status: active.status === "queued" ? "queued" : "running", modelId: frozen.resolvedModelId,
            provider: null, model: null, createdAt: active.createdAt.toISOString(), publishedRevision: null, errorCode: null,
        }));
    }

    async getStoryDeepReadRevision(storyId: string, revision: number): Promise<RevisionDetail> {
        return safeStorage(async () => {
            const row = await this.prisma.artifactRevision.findFirst({ where: { revision, artifact: { storyId, kind } } });
            if (!row) fail("not_found");
            return this.deepReadDetail(this.prisma, row, storyId);
        });
    }

    async findStoryDeepReadRevisionByRun(runId: string): Promise<RevisionDetail | null> {
        return safeStorage(async () => {
            const row = await this.prisma.artifactRevision.findUnique({ where: { workflowRunId: runId }, include: { artifact: true } });
            if (!row || row.artifact.kind !== kind) return null;
            return this.deepReadDetail(this.prisma, row, row.artifact.storyId);
        });
    }
}
