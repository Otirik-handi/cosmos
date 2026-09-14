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
