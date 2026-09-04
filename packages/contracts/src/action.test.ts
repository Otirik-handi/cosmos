import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
    actionDefinitionSchema,
    actionDescriptorSchema,
    actionErrorCodeSchema,
    actionExecutionSchema,
    actionKindSchema,
    actionManifestSchema,
    actionRefSchema,
    assetSnapshotSchema,
    blobRefSchema,
    executionPlacementSchema,
    jobKindSchema,
    normalizedAssetInputSchema,
    parseActionRef,
    retryPolicySchema,
    sourceExecutionSnapshotSchema,
    sourceSnapshotSchema,
} from "./index.js";

describe("Action contracts", () => {
    it("requires a canonical namespace.operation@positive-integer ref", () => {
        for (const ref of [
            "source.fetch@1",
            "library.ingest@1",
            "connector.imap.poll@7",
            "agent.run@12",
        ]) {
            expect(actionRefSchema.parse(ref)).toBe(ref);
        }

        for (const ref of [
            "source.fetch",
            "source.fetch@v1",
            "source.fetch@0",
            "source.fetch@01",
            "Source.fetch@1",
            "source..fetch@1",
            "source.fetch@1 ",
            "source.fetch@9007199254740992",
        ]) {
            expect(() => actionRefSchema.parse(ref)).toThrow();
        }
    });

    it("parses the version embedded in the ref", () => {
        expect(parseActionRef("connector.imap.poll@7")).toEqual({
            baseRef: "connector.imap.poll",
            version: 7,
        });
    });

    it("exposes the fixed kinds and execution placements", () => {
        expect(actionKindSchema.options).toEqual([
            "connector",
            "transform",
            "library",
            "query",
            "control",
            "script",
            "agent",
            "artifact",
            "render",
            "delivery",
        ]);
        expect(executionPlacementSchema.options).toEqual([
            "host",
            "trusted_worker",
            "remote_worker",
        ]);
    });

    it("keeps executable Zod schemas out of the serializable descriptor", () => {
        const definition = actionDefinitionSchema.parse({
            ref: "source.fetch@1",
            kind: "connector",
            description: "Fetch a configured source.",
            capabilities: ["source:read"],
            executionPlacement: "trusted_worker",
            inputSchema: z.object({ cursor: z.string().nullable() }),
            outputSchema: z.object({ items: z.array(z.unknown()) }),
            execution: {
                idempotent: true,
                supportsCancellation: true,
                timeoutMs: 30_000,
                retryPolicy: {
                    maxAttempts: 3,
                    backoffMs: 1_000,
                    retryableErrors: ["timeout", "rate_limited"],
                },
            },
        });

        const descriptor = actionDescriptorSchema.parse({
            ref: definition.ref,
            version: 1,
            kind: definition.kind,
            description: definition.description,
            capabilities: definition.capabilities,
            executionPlacement: definition.executionPlacement,
            idempotent: definition.execution.idempotent,
            supportsCancellation: definition.execution.supportsCancellation,
            timeoutMs: definition.execution.timeoutMs,
            retryPolicy: definition.execution.retryPolicy,
        });

        expect(descriptor).not.toHaveProperty("inputSchema");
        expect(descriptor).not.toHaveProperty("outputSchema");
        expect(JSON.parse(JSON.stringify(descriptor))).toEqual(descriptor);
        expect(() => actionDescriptorSchema.parse({ ...descriptor, version: 2 })).toThrow();
    });

    it("validates execution and retry policy constraints", () => {
        expect(retryPolicySchema.parse({
            maxAttempts: 3,
            backoffMs: 1_000,
            retryableErrors: ["timeout"],
        })).toEqual({
            maxAttempts: 3,
            backoffMs: 1_000,
            retryableErrors: ["timeout"],
        });
        expect(actionExecutionSchema.parse({
            idempotent: false,
            supportsCancellation: false,
            timeoutMs: null,
            retryPolicy: null,
        }).idempotent).toBe(false);
        expect(() => retryPolicySchema.parse({ maxAttempts: 0, backoffMs: 0 })).toThrow();
        expect(() => actionExecutionSchema.parse({
            idempotent: true,
            supportsCancellation: true,
            timeoutMs: 0,
            retryPolicy: null,
        })).toThrow();
    });

    it("contains registry and legacy job error kinds without changing product run status", () => {
        expect(actionErrorCodeSchema.options).toContain("invalid_action_ref");
        expect(actionErrorCodeSchema.options).toContain("unknown_action");
        expect(actionErrorCodeSchema.options).toContain("invalid_input");
        expect(actionErrorCodeSchema.options).toContain("malformed_payload");
        expect(actionErrorCodeSchema.options).toContain("internal_error");
        expect(jobKindSchema.parse("workflow-activity")).toBe("workflow-activity");
        expect(() => jobKindSchema.parse("unknown-job-kind")).toThrow();
    });

    it("separates immutable source execution data from mutable diagnostics", () => {
        const executionSnapshot = sourceExecutionSnapshotSchema.parse({
            id: "source-1",
            name: "Fixture source",
            sourceDefinitionRef: "source.fixture-rss@1",
            operationId: "fetch",
            connectorId: "fixture-rss",
            kind: "fixture-rss",
            config: { fixturePath: "fixtures/feed.xml" },
            enabled: true,
            revisionId: "source-1:1",
            createdAt: "2026-08-15T00:00:00.000Z",
            updatedAt: "2026-08-15T00:00:00.000Z",
        });

        expect(executionSnapshot).not.toHaveProperty("lastRunAt");
        expect(executionSnapshot).not.toHaveProperty("lastError");
        expect(sourceSnapshotSchema.parse({
            ...executionSnapshot,
            lastRunAt: null,
            lastError: null,
        })).toMatchObject({ id: "source-1", lastRunAt: null });
    });

    it("keeps normalized assets and manifests JSON serializable", () => {
        const blobRef = blobRefSchema.parse({
            key: "blobs/sha256/item-1",
            hash: "sha256:item-1",
            byteSize: 12,
            mediaType: "image/png",
        });
        const asset = normalizedAssetInputSchema.parse({
            kind: "thumbnail",
            sourceUrl: "https://example.test/image.png",
            status: "saved",
            mimeType: "image/png",
            byteSize: 12,
            blobRef,
        });
        expect(JSON.parse(JSON.stringify(asset))).toEqual(asset);
        expect(() => normalizedAssetInputSchema.parse({
            ...asset,
            content: new Uint8Array([1, 2, 3]),
        })).toThrow();
        expect(() => blobRefSchema.parse({
            ...blobRef,
            extra: "not allowed",
        })).toThrow();
        expect(actionManifestSchema.parse({
            ref: "source.fetch@1",
            version: 1,
            kind: "connector",
            description: "Fetch a source.",
            capabilities: ["source:read"],
            executionPlacement: "trusted_worker",
            idempotent: true,
            supportsCancellation: true,
            timeoutMs: 30_000,
            retryPolicy: null,
        })).not.toHaveProperty("inputSchema");
    });
});

describe("asset errorMessage contract (ADR-0005)", () => {
    it("accepts a degraded asset with a bounded errorMessage", () => {
        const asset = normalizedAssetInputSchema.parse({
            kind: "image",
            sourceUrl: "https://example.test/a.png",
            status: "skipped",
            mimeType: null,
            byteSize: null,
            blobRef: null,
            errorMessage: "图片超过单文件大小上限（10MB）",
        });
        expect(asset.errorMessage).toBe("图片超过单文件大小上限（10MB）");
    });

    it("keeps errorMessage optional for saved assets", () => {
        const saved = normalizedAssetInputSchema.parse({
            kind: "image",
            sourceUrl: "https://example.test/a.png",
            status: "saved",
            mimeType: "image/png",
            byteSize: 12,
            blobRef: {
                key: "sha256/ab/123",
                hash: "sha256:123",
                byteSize: 12,
                mediaType: "image/png",
            },
        });
        expect(saved.errorMessage).toBeUndefined();
    });

    it("surfaces errorMessage on the public asset snapshot", () => {
        const snapshot = assetSnapshotSchema.parse({
            id: "asset-1",
            kind: "image",
            status: "failed",
            sourceUrl: "https://example.test/a.png",
            storageKey: null,
            mimeType: null,
            byteSize: null,
            errorMessage: "图片下载超时",
        });
        expect(snapshot.errorMessage).toBe("图片下载超时");
        expect(assetSnapshotSchema.parse({
            id: "asset-2",
            kind: "image",
            status: "saved",
            sourceUrl: "https://example.test/a.png",
            storageKey: "sha256/ab/123",
            mimeType: "image/png",
            byteSize: 12,
        }).errorMessage).toBeUndefined();
    });
});
