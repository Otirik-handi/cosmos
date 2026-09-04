import { describe, expect, it } from "vitest";

import { ActionRegistry } from "./action.js";
import { createIngestActions } from "./workflow-ingest.js";

const source = {
    id: "source-1",
    name: "Fixture",
    sourceDefinitionRef: "source.fixture-rss@1",
    operationId: "fetch",
    connectorId: "fixture-rss",
    kind: "fixture-rss",
    config: {},
    enabled: true,
    revisionId: "source-1:1",
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:00.000Z",
};

function context() {
    return {
        idempotencyKey: "source-fetch-test",
        signal: new AbortController().signal,
    };
}

function actionsWith(fetchItems: () => Promise<never>, validate: () => void = () => undefined) {
    return new ActionRegistry(createIngestActions({
        resolveConnector: () => ({
            id: "fixture-rss",
            description: "Test connector",
            configVersion: "fixture-rss@1",
            capabilities: ["source:read"],
            validate,
            fetchItems,
        }),
        blobs: {
            put: async () => ({ key: "unused", hash: "unused", byteSize: 0, mimeType: null }),
            read: async () => new Uint8Array(),
        },
        domain: {
            persistWorkflowIngestItem: async () => ({
                createdEntry: false,
                revisedEntry: false,
                duplicateObservation: false,
            }),
            setWorkflowIngestCheckpoint: async () => ({
                sourceId: "source-1",
                cursor: null,
                revision: 0,
                committed: true,
            }),
        },
    }));
}

describe("source.fetch connector error classification", () => {
    it("keeps unknown transport failures retryable", async () => {
        const actions = actionsWith(async () => {
            throw new Error("network temporarily unavailable");
        });
        await expect(actions.dispatch(
            "source.fetch@1",
            { source, cursor: null },
            context(),
        )).rejects.toMatchObject({
            code: "dependency_unavailable",
            retryable: true,
        });
    });

    it("keeps unknown validation failures terminal", async () => {
        const actions = actionsWith(
            async () => ({ items: [], nextCursor: null }) as never,
            () => {
                throw new Error("missing fixture configuration");
            },
        );
        await expect(actions.dispatch(
            "source.fetch@1",
            { source, cursor: null },
            context(),
        )).rejects.toMatchObject({
            code: "invalid_configuration",
            retryable: false,
        });
    });
});

import type { NormalizedIngestItem } from "@cosmos/domain";
import { createMediaAcquirer, mediaDownloadCapability } from "./media-acquisition.js";

function ingestItemWithImage(): NormalizedIngestItem {
    return {
        externalId: "media-1",
        title: "Media entry",
        summary: null,
        contentText: "Body",
        webUrl: "https://example.test/post/1",
        kind: "article",
        publisher: null,
        metrics: null,
        publishedAt: null,
        updatedAt: null,
        sourceLocator: { provider: "rss", feedUrl: "https://example.test/feed.xml" },
        rawPayload: "<item/>",
        assets: [{
            kind: "image",
            sourceUrl: "https://media.example.test/a.png",
            status: "metadata_only",
            mimeType: null,
            byteSize: null,
            content: null,
        }],
    };
}

function actionsWithMedia(options: {
    capabilities?: readonly string[];
    withAcquirer?: boolean;
    items?: readonly NormalizedIngestItem[];
}) {
    const capabilities = options.capabilities ?? [mediaDownloadCapability];
    const items = options.items ?? [ingestItemWithImage()];
    const withAcquirer = options.withAcquirer ?? true;
    const puts: Array<{ content: Uint8Array; mimeType: string | null }> = [];
    const blobs = {
        put: async (content: Uint8Array, meta?: { mimeType?: string | null }) => {
            puts.push({ content, mimeType: meta?.mimeType ?? null });
            return {
                key: "sha256/aa/1",
                hash: "sha256:1",
                byteSize: content.byteLength,
                mimeType: meta?.mimeType ?? null,
            };
        },
        read: async () => new Uint8Array(),
    };
    const acquirer = createMediaAcquirer({
        fetch: async () => new Response(
            new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            { status: 200, headers: { "content-type": "image/png" } },
        ),
        resolveHost: async () => ["93.184.216.34"],
    });
    const registry = new ActionRegistry(createIngestActions({
        resolveConnector: () => ({
            id: "rss",
            description: "Media connector",
            configVersion: "v1",
            capabilities: [...capabilities],
            validate: () => undefined,
            fetchItems: async () => ({ items, nextCursor: null }),
        }),
        blobs,
        domain: {
            persistWorkflowIngestItem: async () => ({
                createdEntry: false,
                revisedEntry: false,
                duplicateObservation: false,
            }),
            setWorkflowIngestCheckpoint: async () => ({
                sourceId: "source-1",
                cursor: null,
                revision: 0,
                committed: true,
            }),
        },
        mediaAcquirer: withAcquirer ? acquirer : undefined,
    }));
    return { registry, puts };
}

describe("source.fetch media acquisition wiring (ADR-0005)", () => {
    it("downloads image candidates into a BlobRef for media-capable connectors", async () => {
        const { registry, puts } = actionsWithMedia({});
        const output = await registry.dispatch(
            "source.fetch@1",
            { source, cursor: null },
            context(),
        ) as { items: Array<{ assets: Array<{ status: string; blobRef: unknown }> }> };
        expect(output.items[0].assets[0].status).toBe("saved");
        expect(output.items[0].assets[0].blobRef).not.toBeNull();
        expect(puts).toHaveLength(1);
    });

    it("keeps candidates untouched when the connector lacks media capability", async () => {
        const { registry, puts } = actionsWithMedia({
            capabilities: ["network", "rss"],
        });
        const output = await registry.dispatch(
            "source.fetch@1",
            { source, cursor: null },
            context(),
        ) as { items: Array<{ assets: Array<{ status: string; blobRef: unknown }> }> };
        expect(output.items[0].assets[0].status).toBe("metadata_only");
        expect(output.items[0].assets[0].blobRef).toBeNull();
        expect(puts).toHaveLength(0);
    });

    it("keeps candidates untouched when no acquirer is configured", async () => {
        const { registry, puts } = actionsWithMedia({ withAcquirer: false });
        const output = await registry.dispatch(
            "source.fetch@1",
            { source, cursor: null },
            context(),
        ) as { items: Array<{ assets: Array<{ status: string; blobRef: unknown }> }> };
        expect(output.items[0].assets[0].status).toBe("metadata_only");
        expect(puts).toHaveLength(0);
    });
});
