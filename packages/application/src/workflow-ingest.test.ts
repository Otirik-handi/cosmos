import { describe, expect, it } from "vitest";

import { ActionRegistry } from "./action.js";
import { createIngestActions } from "./workflow-ingest.js";

const source = {
    id: "source-1",
    name: "Fixture",
    kind: "fixture-rss",
    config: {},
    enabled: true,
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
