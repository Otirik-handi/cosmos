import type { ArtifactRead, DeepReadGeneration, DeepReadGenerationRequest, StoryDeepReadRevisionDetail } from "@cosmos/contracts";
export type { ArtifactRead, DeepReadGeneration, DeepReadGenerationRequest, StoryDeepReadRevisionDetail } from "@cosmos/contracts";

export interface StoryDeepReadClient {
    createStoryDeepRead(storyId: string, request: DeepReadGenerationRequest, idempotencyKey: string): Promise<DeepReadGeneration>;
    storyDeepReadGeneration(storyId: string, runId: string): Promise<DeepReadGeneration>;
    storyDeepReadArtifact(storyId: string): Promise<ArtifactRead>;
    storyDeepReadRevision(storyId: string, revision: number): Promise<StoryDeepReadRevisionDetail>;
}

export interface CosmosEventSource {
    onmessage: ((event: { data: string }) => void) | null;
    onerror: (() => void) | null;
    close(): void;
}

export interface HttpCosmosClientOptions {
    baseUrl: string;
    fetch?: typeof globalThis.fetch;
    eventSourceFactory?: (url: string) => CosmosEventSource;
}

export class CosmosTransportError extends Error {
    readonly status: number;
    readonly body: unknown;

    get code(): string | undefined {
        const body = this.body;
        return body !== null && typeof body === "object" && "code" in body && typeof body.code === "string" ? body.code : undefined;
    }

    constructor(status: number, body: unknown) {
        super(`Cosmos service request failed with HTTP ${status}.`);
        this.name = "CosmosTransportError";
        this.status = status;
        this.body = body;
    }
}
