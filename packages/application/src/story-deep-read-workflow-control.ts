import { createHash } from "node:crypto";
import { canonicalJson, UuidIdGenerator, type JsonValue } from "@notnotype/nb-workflow";
import { z } from "zod";
import { artifactReadSchema, deepReadGenerationSchema, deepReadGenerationRequestSchema, deepReadRequestHashInputSchema,
    deepReadErrorCodeSchema, storyDeepReadRevisionDetailSchema, type DeepReadGeneration, type DeepReadGenerationRequest } from "@cosmos/contracts";
import type { ContentQuery } from "./content-query.js";
import type { SystemConfigRepository } from "./system-config.js";
import type { WorkflowEnvelope, WorkflowHostStore } from "./workflow-host.js";
import type { StoryDeepReadStore } from "./story-deep-read-store.js";
import { prepareStoryDeepRead, StoryDeepReadError, storyDeepReadWorkflowInputSchema, type StoryDeepReadSnapshotReader } from "./story-deep-read-preparation.js";

export const storyDeepReadWorkflowManifestHash = "builtin:cosmos.story-deep-read@1";
export function storyDeepReadRequestHash(storyId: string, modelId?: string): string {
    return createHash("sha256").update(canonicalJson(deepReadRequestHashInputSchema.parse({ storyId, modelId: modelId ?? null }))).digest("hex");
}
export class StoryDeepReadWorkflowControl {
    constructor(private readonly options: {
        store: StoryDeepReadStore;
        workflows: Pick<WorkflowHostStore, "loadWorkflowEnvelope" | "findWorkflowEnvelopeByIdempotencyKey">;
        stories: StoryDeepReadSnapshotReader;
        content: Pick<ContentQuery, "structuredContent">;
        systemConfig: Pick<SystemConfigRepository, "getDefaultModelId" | "getModelSelection" | "getStoryAgentTimeoutSeconds">;
        failureCodes?: { getStoryAgentFailureCode(runId: string, definitionKey?: string): Promise<string | null> };
    }) {}

    async enqueueStoryDeepRead(input: DeepReadGenerationRequest & { storyId: string; idempotencyKey: string }): Promise<DeepReadGeneration> {
        return this.safe(async () => {
            const storyId = z.string().trim().min(1).max(200).parse(input.storyId);
            const key = z.string().trim().min(1).max(200).parse(input.idempotencyKey);
            const request = deepReadGenerationRequestSchema.parse({ ...(input.modelId === undefined ? {} : { modelId: input.modelId }) });
            const requestHash = storyDeepReadRequestHash(storyId, request.modelId);
            const existing = await this.options.store.findStoryDeepReadRequest(key);
            if (existing) {
                if (existing.storyId !== storyId || existing.requestHash !== requestHash) throw new StoryDeepReadError("conflict");
                return this.project(existing.run, storyId);
            }
            const artifact = await this.options.store.getStoryDeepReadArtifact(storyId);
            if (artifact?.generation && ["queued", "running", "waiting"].includes(artifact.generation.status)) {
                throw new StoryDeepReadError("conflict");
            }
            const modelId = request.modelId ?? await this.options.systemConfig.getDefaultModelId();
            const selection = modelId ? await this.options.systemConfig.getModelSelection(modelId) : null;
            if (!modelId || !selection || selection.model.id !== modelId || selection.providerState !== "active") {
                throw new StoryDeepReadError("invalid_configuration");
            }
            const timeout = await this.options.systemConfig.getStoryAgentTimeoutSeconds();
            const snapshot = await prepareStoryDeepRead(this.options.stories, this.options.content, storyId, modelId, timeout * 1000);
            const result = await this.options.store.enqueueStoryDeepRead({ storyId, requestHash, runId: new UuidIdGenerator().nextId("run"),
                idempotencyKey: key, definition: { key: "cosmos.story-deep-read", version: "1", manifestHash: storyDeepReadWorkflowManifestHash },
                inputSnapshot: json(snapshot), productRun: { storyId, status: "queued" } });
            return this.project(result.run, storyId);
        });
    }
    async getDeepReadGeneration(storyId: string, runId: string): Promise<DeepReadGeneration> {
        return this.safe(async () => {
            const run = await this.options.workflows.loadWorkflowEnvelope(runId);
            if (!run) throw new StoryDeepReadError("not_found");
            return this.project(run, storyId);
        });
    }
    async getDeepReadArtifact(storyId: string) {
        return this.safe(async () => {
            const artifact = await this.options.store.getStoryDeepReadArtifact(storyId);
            if (!artifact) return artifactReadSchema.parse({ artifact: null });
            if (artifact.storyId !== storyId) throw new StoryDeepReadError("not_found");
            const generation = artifact.generation ? await this.getDeepReadGeneration(storyId, artifact.generation.runId) : null;
            return artifactReadSchema.parse({ artifact: { ...artifact,
                generation: generation && ["queued", "running"].includes(generation.status) ? generation : null } });
        });
    }
    async getDeepReadRevision(storyId: string, revision: number) {
        return this.safe(async () => {
            const detail = storyDeepReadRevisionDetailSchema.parse(await this.options.store.getStoryDeepReadRevision(storyId, z.number().int().positive().safe().parse(revision)));
            if (detail.storyId !== storyId || detail.revision !== revision) throw new StoryDeepReadError("not_found");
            return detail;
        });
    }
    private async project(run: WorkflowEnvelope, storyId: string): Promise<DeepReadGeneration> {
        const snapshot = storyDeepReadWorkflowInputSchema.safeParse(run.inputSnapshot);
        if (run.definition.key !== "cosmos.story-deep-read" || run.definition.version !== "1"
            || !snapshot.success || snapshot.data.storyId !== storyId) throw new StoryDeepReadError("not_found");
        const published = await this.options.store.findStoryDeepReadRevisionByRun(run.runId);
        if (published && (published.storyId !== storyId || published.workflowRunId !== run.runId)) throw new StoryDeepReadError("not_found");
        const status = published ? "completed" : run.status === "completed" ? "failed" : run.status === "waiting" ? "running" : run.status;
        const rawCode = status === "failed" ? await this.options.failureCodes?.getStoryAgentFailureCode(run.runId, "cosmos.story-deep-read") : null;
        const code = deepReadErrorCodeSchema.safeParse(rawCode);
        return deepReadGenerationSchema.parse({ runId: run.runId, storyId, status, modelId: snapshot.data.resolvedModelId,
            provider: published?.provider ?? null, model: published?.model ?? null, createdAt: run.createdAt,
            publishedRevision: published?.revision ?? null, errorCode: status === "failed" ? code.success ? code.data : "generation_failed" : null,
            ...(published?.cost === undefined ? {} : { cost: published.cost }) });
    }
    private async safe<T>(operation: () => Promise<T>): Promise<T> {
        try { return await operation(); } catch (error) {
            if (error instanceof StoryDeepReadError) throw error;
            const code = error instanceof Error && "code" in error ? error.code : undefined;
            const known = z.enum(["not_found", "conflict", "invalid_configuration", "malformed_payload", "dependency_unavailable"]).safeParse(code);
            if (known.success) throw new StoryDeepReadError(known.data, known.data === "dependency_unavailable"
                && error instanceof Error && "retryable" in error && error.retryable === true);
            throw new StoryDeepReadError(error instanceof z.ZodError ? "validation_failed" : "dependency_unavailable");
        }
    }
}
function json(value: unknown): JsonValue { return JSON.parse(JSON.stringify(value)) as JsonValue; }
