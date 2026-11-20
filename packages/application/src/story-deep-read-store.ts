import type { ArtifactSnapshot, StoryDeepReadRevisionDetail } from "@cosmos/contracts";
import type { HostActionExecutionFence } from "./action.js";
import type { CreateWorkflowEnvelopeInput, WorkflowEnvelope } from "./workflow-host.js";

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
export interface StoryDeepReadStore {
    findStoryDeepReadRequest(idempotencyKey: string): Promise<{ storyId: string; requestHash: string; run: WorkflowEnvelope } | null>;
    enqueueStoryDeepRead(input: EnqueueStoryDeepReadInput): Promise<{ run: WorkflowEnvelope; artifactId: string; reused: boolean }>;
    publishStoryDeepReadRevision(input: PublishStoryDeepReadRevisionInput): Promise<StoryDeepReadRevisionDetail>;
    getStoryDeepReadArtifact(storyId: string): Promise<ArtifactSnapshot | null>;
    getStoryDeepReadRevision(storyId: string, revision: number): Promise<StoryDeepReadRevisionDetail>;
    findStoryDeepReadRevisionByRun(runId: string): Promise<StoryDeepReadRevisionDetail | null>;
}
