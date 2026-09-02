import {
    createSourceCommandSchema,
    connectorDescriptorSchema,
    feedPageSchema,
    healthResponseSchema,
    jobSnapshotSchema,
    runSnapshotSchema,
    searchPageSchema,
    sourceActivationCommandSchema,
    sourceConfigProbeCommandSchema,
    sourceConfigProbeJobSnapshotSchema,
    sourceDefinitionPageSchema,
    sourceSnapshotSchema,
    storyDetailSchema,
    entryDetailSchema,
    entryPageSchema,
    revisionDetailSchema,
    sseEventSchema,
    type CreateSourceCommand,
    type ConnectorDescriptor,
    type FeedPage,
    type HealthResponse,
    type JobSnapshot,
    type RunSnapshot,
    type SearchPage,
    type SearchQuery,
    type SourceActivationCommand,
    type SourceConfigProbeCommand,
    type SourceConfigProbeJobSnapshot,
    type SourceDefinitionManifest,
    type SourceSnapshot,
    type StoryDetail,
    type SseEvent,
    type EntryDetail,
    type EntryListQuery,
    type EntryPage,
    type RevisionDetail,
    type UpdateSourceCommand,
} from "@cosmos/contracts";

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

    constructor(status: number, body: unknown) {
        super(`Cosmos service request failed with HTTP ${status}.`);
        this.name = "CosmosTransportError";
        this.status = status;
        this.body = body;
    }
}

export class HttpCosmosClient {
    private readonly baseUrl: string;
    private readonly fetcher: typeof globalThis.fetch;
    private readonly eventSourceFactory: (
        url: string,
    ) => CosmosEventSource;

    constructor(options: HttpCosmosClientOptions) {
        this.baseUrl = options.baseUrl.replace(/\/+$/, "");
        this.fetcher = (
            options.fetch ?? globalThis.fetch
        ).bind(globalThis);
        this.eventSourceFactory = options.eventSourceFactory
            ?? ((url): CosmosEventSource => {
                const EventSourceConstructor = (
                    globalThis as typeof globalThis & {
                        EventSource?: new (url: string) => CosmosEventSource;
                    }
                ).EventSource;
                if (!EventSourceConstructor) {
                    throw new Error("EventSource is not available in this runtime.");
                }
                return new EventSourceConstructor(url) as CosmosEventSource;
            });
    }

    async health(): Promise<HealthResponse> {
        return this.request("/api/v1/health", {
            schema: healthResponseSchema,
        });
    }

    async listConnectors(): Promise<readonly ConnectorDescriptor[]> {
        return this.request("/api/v1/connectors", {
            schema: connectorDescriptorSchema.array(),
        });
    }

    async listSourceDefinitions(): Promise<readonly SourceDefinitionManifest[]> {
        const page = await this.request("/api/v1/source-definitions", {
            schema: sourceDefinitionPageSchema,
        });
        return page.items;
    }

    async createSourceConfigProbe(
        input: SourceConfigProbeCommand,
        idempotencyKey?: string,
    ): Promise<SourceConfigProbeJobSnapshot> {
        const payload = sourceConfigProbeCommandSchema.parse(input);
        return this.request("/api/v1/source-config-probes", {
            method: "POST",
            headers: idempotencyKey
                ? { "idempotency-key": idempotencyKey }
                : undefined,
            body: payload,
            schema: sourceConfigProbeJobSnapshotSchema,
        });
    }

    async getSourceConfigProbe(jobId: string): Promise<SourceConfigProbeJobSnapshot> {
        return this.request(`/api/v1/source-config-probes/${encodeURIComponent(jobId)}`, {
            schema: sourceConfigProbeJobSnapshotSchema,
        });
    }

    async listSources(): Promise<readonly SourceSnapshot[]> {
        return this.request("/api/v1/sources", {
            schema: sourceSnapshotSchema.array(),
        });
    }

    async getSource(sourceId: string): Promise<SourceSnapshot> {
        return this.request(`/api/v1/sources/${encodeURIComponent(sourceId)}`, {
            schema: sourceSnapshotSchema,
        });
    }

    async createSource(input: CreateSourceCommand): Promise<SourceSnapshot> {
        const payload = createSourceCommandSchema.parse(input);
        return this.request("/api/v1/sources", {
            method: "POST",
            body: payload,
            schema: sourceSnapshotSchema,
        });
    }

    async updateSource(
        sourceId: string,
        input: UpdateSourceCommand,
    ): Promise<SourceSnapshot> {
        return this.request(`/api/v1/sources/${encodeURIComponent(sourceId)}`, {
            method: "PATCH",
            body: input,
            schema: sourceSnapshotSchema,
        });
    }

    async activateSource(
        sourceId: string,
        input: SourceActivationCommand,
        idempotencyKey: string,
    ): Promise<SourceSnapshot> {
        const payload = sourceActivationCommandSchema.parse(input);
        return this.request(`/api/v1/sources/${encodeURIComponent(sourceId)}/activation-commands`, {
            method: "POST",
            headers: { "idempotency-key": idempotencyKey },
            body: payload,
            schema: sourceSnapshotSchema,
        });
    }

    async testSource(sourceId: string, idempotencyKey?: string): Promise<JobSnapshot> {
        return this.request(`/api/v1/sources/${encodeURIComponent(sourceId)}/test`, {
            method: "POST",
            headers: idempotencyKey
                ? { "idempotency-key": idempotencyKey }
                : undefined,
            schema: jobSnapshotSchema,
        });
    }

    async triggerSource(
        sourceId: string,
        options: { idempotencyKey?: string } = {},
    ): Promise<RunSnapshot> {
        return this.request(`/api/v1/sources/${encodeURIComponent(sourceId)}/runs`, {
            method: "POST",
            headers: options.idempotencyKey
                ? { "idempotency-key": options.idempotencyKey }
                : undefined,
            schema: runSnapshotSchema,
        });
    }

    async getJob(jobId: string): Promise<JobSnapshot> {
        return this.request(`/api/v1/jobs/${encodeURIComponent(jobId)}`, {
            schema: jobSnapshotSchema,
        });
    }

    async feed(options: {
        cursor?: string;
        limit?: number;
    } = {}): Promise<FeedPage> {
        const params = new URLSearchParams();
        if (options.cursor) {
            params.set("cursor", options.cursor);
        }
        if (options.limit) {
            params.set("limit", String(options.limit));
        }
        return this.request(`/api/v1/feed?${params.toString()}`, {
            schema: feedPageSchema,
        });
    }

    async search(query: SearchQuery): Promise<SearchPage> {
        const params = new URLSearchParams();
        if (query.text) {
            params.set("text", query.text);
        }
        if (query.sourceId) {
            params.set("sourceId", query.sourceId);
        }
        if (query.publishedAfter) {
            params.set("publishedAfter", query.publishedAfter);
        }
        if (query.publishedBefore) {
            params.set("publishedBefore", query.publishedBefore);
        }
        if (query.cursor) {
            params.set("cursor", query.cursor);
        }
        if (query.limit) {
            params.set("limit", String(query.limit));
        }
        return this.request(`/api/v1/search?${params.toString()}`, {
            schema: searchPageSchema,
        });
    }

    async story(storyId: string): Promise<StoryDetail> {
        return this.request(`/api/v1/stories/${encodeURIComponent(storyId)}`, {
            schema: storyDetailSchema,
        });
    }

    async entries(query: EntryListQuery = {}): Promise<EntryPage> {
        const params = new URLSearchParams();
        if (query.sourceId) {
            params.set("sourceId", query.sourceId);
        }
        if (query.cursor) {
            params.set("cursor", query.cursor);
        }
        if (query.limit) {
            params.set("limit", String(query.limit));
        }
        return this.request(`/api/v1/entries?${params.toString()}`, {
            schema: entryPageSchema,
        });
    }

    async entry(entryId: string): Promise<EntryDetail> {
        return this.request(`/api/v1/entries/${encodeURIComponent(entryId)}`, {
            schema: entryDetailSchema,
        });
    }

    async revision(revisionId: string): Promise<RevisionDetail> {
        return this.request(`/api/v1/revisions/${encodeURIComponent(revisionId)}`, {
            schema: revisionDetailSchema,
        });
    }

    openEventStream(options: {
        afterEventId?: string;
        onEvent: (event: SseEvent) => void;
        onError?: () => void;
    }): () => void {
        const params = new URLSearchParams();
        if (options.afterEventId) {
            params.set("after", options.afterEventId);
        }
        const query = params.toString();
        const source = this.eventSourceFactory(
            `${this.baseUrl}/api/v1/events${query ? `?${query}` : ""}`,
        );
        source.onmessage = (message) => {
            try {
                options.onEvent(sseEventSchema.parse(JSON.parse(message.data)));
            } catch {
                options.onError?.();
            }
        };
        source.onerror = () => {
            options.onError?.();
        };
        return () => source.close();
    }

    private async request<TSchema extends { parse: (value: unknown) => unknown }>(
        path: string,
        options: {
            method?: "GET" | "POST" | "PATCH";
            body?: unknown;
            headers?: Record<string, string>;
            schema: TSchema;
        },
    ): Promise<ReturnType<TSchema["parse"]>> {
        const response = await this.fetcher(`${this.baseUrl}${path}`, {
            method: options.method ?? "GET",
            headers: {
                ...(options.body ? { "content-type": "application/json" } : {}),
                ...(options.headers ?? {}),
            },
            body: options.body ? JSON.stringify(options.body) : undefined,
        });

        const body = await response.json().catch(() => null);
        if (!response.ok) {
            throw new CosmosTransportError(response.status, body);
        }

        return options.schema.parse(body) as ReturnType<TSchema["parse"]>;
    }
}
