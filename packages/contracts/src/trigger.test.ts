import { describe, expect, it } from "vitest";

import {
    createSourceCommandSchema,
    ingestTriggerEvidenceSchema,
    ingestTriggerKindSchema,
    sourceDefinitionManifestSchema,
    triggerBindingSchema,
    triggerConfigSchema,
} from "./index.js";

describe("Trigger/SDK contracts (ADR-0018)", () => {
    it("validates a schedule trigger binding", () => {
        const binding = triggerBindingSchema.parse({
            id: "trigger:source-1",
            sourceId: "source-1",
            kind: "schedule",
            config: { intervalMs: 1_800_000 },
            enabled: true,
            revisionId: "source-1:1",
            createdAt: "2026-09-10T08:00:00.000Z",
            updatedAt: "2026-09-10T08:00:00.000Z",
        });
        expect(binding.config.intervalMs).toBe(1_800_000);
    });

    it("rejects a trigger config with an unknown field", () => {
        expect(() => triggerConfigSchema.parse({ intervalMs: 1000, cron: "* * * * *" })).toThrow();
    });

    it("accepts a top-level scheduleIntervalMs on the source command", () => {
        expect(createSourceCommandSchema.parse({
            name: "x",
            sourceDefinitionRef: "source.rss@1",
            operationId: "fetch",
            config: { feedUrl: "https://example.com/feed.xml" },
            scheduleIntervalMs: 60_000,
        }).scheduleIntervalMs).toBe(60_000);
    });

    it("accepts a webhook binding and rejects the trigger kinds deferred to Phase 3", () => {
        const binding = triggerBindingSchema.parse({
            id: "trigger:plan-1",
            sourceId: "source-1",
            kind: "webhook",
            config: {},
            enabled: true,
            revisionId: "plan-1:1",
            createdAt: "2026-09-22T08:00:00.000Z",
            updatedAt: "2026-09-22T08:00:00.000Z",
        });
        expect(binding.kind).toBe("webhook");
        for (const deferred of ["event", "condition", "dependency"]) {
            expect(() => triggerBindingSchema.parse({ ...binding, kind: deferred })).toThrow();
        }
    });

    it("accepts webhook as an ingest trigger kind and rejects unknown kinds", () => {
        expect(ingestTriggerKindSchema.parse("webhook")).toBe("webhook");
        expect(() => ingestTriggerKindSchema.parse("event")).toThrow();
    });

    it("keeps trigger evidence whole: three fields in, no partial or extra fields", () => {
        const evidence = {
            bindingId: "hook_abc",
            externalEventId: "evt-1",
            receivedAt: "2026-09-22T08:00:00.000Z",
        };
        expect(ingestTriggerEvidenceSchema.parse(evidence)).toEqual(evidence);
        expect(() => ingestTriggerEvidenceSchema.parse({ ...evidence, externalEventId: undefined })).toThrow();
        expect(() => ingestTriggerEvidenceSchema.parse({ ...evidence, secret: "s" })).toThrow();
    });

    it("validates a source definition manifest with auth and per-operation declarations", () => {
        const manifest = sourceDefinitionManifestSchema.parse({
            id: "rss",
            version: 1,
            ref: "source.rss@1",
            provider: "cosmos",
            connectorId: "rss",
            displayName: "RSS",
            description: null,
            manifestHash: { algorithm: "builtin", value: "builtin:source.rss@1" },
            status: "enabled",
            operationIds: ["fetch"],
            capabilities: ["source:read", "cursor"],
            configurationSchema: { id: "c@1", version: 1, hash: { algorithm: "builtin", value: "c@1" } },
            auth: { kind: "none", label: null, secretRefRequired: false },
            operations: [{
                operationId: "fetch",
                inputSchema: { id: "i@1", version: 1, hash: { algorithm: "builtin", value: "i@1" } },
                outputSchema: { id: "o@1", version: 1, hash: { algorithm: "builtin", value: "o@1" } },
                externalKey: "url",
                discoveryContext: "",
                media: "download",
                stateStoreNamespace: "{id}",
            }],
        });
        expect(manifest.auth.kind).toBe("none");
        expect(manifest.operations[0]?.externalKey).toBe("url");
    });
});
