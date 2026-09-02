import { describe, expect, it } from "vitest";

import {
    aiHotSourceConfigSchema,
    bilibiliSourceConfigSchema,
    getSourceConfigurationSchema,
    publisherSchema,
    rssSourceConfigSchema,
    createSourceCommandSchema,
    jobSnapshotSchema,
    sourceConfigProbeCommandSchema,
    sourceConfigProbeJobPayloadSchema,
    sourceConfigProbeJobSnapshotSchema,
    sourceConfigProbeResultSchema,
    sourceExecutionSnapshotSchema,
    sourceProbeResultSchema,
    temporalValueSchema,
    updateSourceCommandSchema,
} from "./index.js";

describe("source and job contracts", () => {
    it("accepts only the supported Bilibili source modes", () => {
        expect(bilibiliSourceConfigSchema.parse({
            mode: "hot",
            limit: 5,
        })).toMatchObject({
            mode: "hot",
            limit: 5,
        });

        expect(() => bilibiliSourceConfigSchema.parse({
            mode: "feed",
            limit: 5,
        })).toThrow();

        expect(() => bilibiliSourceConfigSchema.parse({
            mode: "hot",
            command: ["bilibili", "hot"],
        })).toThrow();
    });

    it("restricts RSS feedUrl to http(s) URLs", () => {
        expect(rssSourceConfigSchema.parse({
            feedUrl: "https://example.test/feed.xml",
        })).toMatchObject({ feedUrl: "https://example.test/feed.xml" });
        expect(() => rssSourceConfigSchema.parse({
            feedUrl: "file:///etc/passwd",
        })).toThrow();
        expect(() => rssSourceConfigSchema.parse({
            feedUrl: "ftp://example.test/feed.xml",
        })).toThrow();
    });

    it("resolves canonical configuration schemas by source definition ref", () => {
        expect(getSourceConfigurationSchema("source.rss@1")).toBe(rssSourceConfigSchema);
        expect(getSourceConfigurationSchema("source.bilibili@1")).toBe(bilibiliSourceConfigSchema);
        expect(getSourceConfigurationSchema("source.unknown@1")).toBeNull();
    });

    it("validates the public AI HOT configuration", () => {
        expect(aiHotSourceConfigSchema.parse({})).toMatchObject({
            schemaVersion: 1,
        });
        expect(() => aiHotSourceConfigSchema.parse({
            endpoint: "https://example.test",
        })).toThrow();
    });

    it("requires a versioned source definition while keeping connector validation separate", () => {
        expect(createSourceCommandSchema.parse({
            name: "Bilibili hot",
            sourceDefinitionRef: "source.bilibili@1",
            operationId: "fetch",
            config: {
                mode: "hot",
                limit: 10,
            },
        }).sourceDefinitionRef).toBe("source.bilibili@1");
    });

    it("requires a versioned source definition and saves new sources disabled", () => {
        const command = createSourceCommandSchema.parse({
            name: "RSS source",
            sourceDefinitionRef: "source.rss@1",
            operationId: "fetch",
            config: { feedUrl: "https://example.test/feed.xml" },
        });

        expect(command).toMatchObject({
            sourceDefinitionRef: "source.rss@1",
            operationId: "fetch",
        });
        expect(command).not.toHaveProperty("enabled");
        expect(() => createSourceCommandSchema.parse({
            ...command,
            enabled: true,
        })).toThrow();
    });

    it("requires a revision guard for complete source replacement", () => {
        expect(updateSourceCommandSchema.parse({
            baseRevisionId: "source-1:2",
            name: "Renamed RSS",
            config: { feedUrl: "https://example.test/new-feed.xml" },
        })).toMatchObject({
            baseRevisionId: "source-1:2",
            config: { feedUrl: "https://example.test/new-feed.xml" },
        });
        expect(() => updateSourceCommandSchema.parse({
            enabled: true,
        })).toThrow();
    });

    it("exposes a revision id in immutable source execution snapshots", () => {
        const snapshot = sourceExecutionSnapshotSchema.parse({
            id: "source-1",
            name: "RSS source",
            kind: "rss",
            sourceDefinitionRef: "source.rss@1",
            operationId: "fetch",
            connectorId: "rss",
            config: { feedUrl: "https://example.test/feed.xml" },
            enabled: false,
            revisionId: "source-1:1",
            createdAt: "2026-08-24T00:00:00.000Z",
            updatedAt: "2026-08-24T00:00:00.000Z",
        });

        expect(snapshot.revisionId).toBe("source-1:1");
    });


    it("validates probe results and job snapshots", () => {
        expect(sourceProbeResultSchema.parse({
            sourceId: "source-1",
            connectorId: "bilibili",
            itemCount: 3,
            nextCursorAvailable: false,
            checkedAt: "2026-08-08T00:00:00.000Z",
        }).itemCount).toBe(3);

        expect(jobSnapshotSchema.parse({
            id: "job-1",
            kind: "source-probe",
            sourceId: "source-1",
            runId: null,
            status: "queued",
            attempts: 0,
            maxAttempts: 3,
            errorCode: null,
            error: null,
            createdAt: "2026-08-08T00:00:00.000Z",
            updatedAt: "2026-08-08T00:00:00.000Z",
            result: null,
        }).kind).toBe("source-probe");
    });

    it("accepts author records without a platform id and normalizes blanks to null", () => {
        expect(publisherSchema.parse({
            platformId: "  ",
            name: "RSS author",
            handle: "",
            profileUrl: null,
            kind: "unknown",
        })).toMatchObject({
            platformId: null,
            name: "RSS author",
            handle: null,
            kind: "unknown",
        });
    });

    it("requires a temporal value to retain exact or fallback evidence", () => {
        expect(() => temporalValueSchema.parse({
            exact: null,
            exactPrecision: null,
            fallback: null,
        })).toThrow();
    });
});

describe("source config probe contracts", () => {
    const probeCommand = {
        sourceDefinitionRef: "source.rss@1",
        operationId: "fetch",
        config: { feedUrl: "https://example.test/feed.xml" },
    } as const;

    it("parses a config probe command and rejects unknown fields", () => {
        expect(sourceConfigProbeCommandSchema.parse(probeCommand)).toEqual(probeCommand);
        expect(() => sourceConfigProbeCommandSchema.parse({
            ...probeCommand,
            sourceId: "source-1",
        })).toThrow();
        expect(() => sourceConfigProbeCommandSchema.parse({
            ...probeCommand,
            sourceDefinitionRef: "source.rss@latest",
        })).toThrow();
    });

    it("parses the job payload wrapper strictly", () => {
        expect(sourceConfigProbeJobPayloadSchema.parse({ configProbe: probeCommand })).toMatchObject({
            configProbe: probeCommand,
        });
        expect(() => sourceConfigProbeJobPayloadSchema.parse({ sourceId: "source-1" })).toThrow();
    });

    it("caps probe results at three sample titles of 200 characters", () => {
        const base = {
            sourceDefinitionRef: "source.rss@1",
            operationId: "fetch",
            connectorId: "rss",
            itemCount: 2,
            nextCursorAvailable: false,
            checkedAt: "2026-08-24T00:00:00.000Z",
            durationMs: 120,
        };
        expect(sourceConfigProbeResultSchema.parse({
            ...base,
            sampleTitles: ["First", "Second"],
        })).toMatchObject({ sampleTitles: ["First", "Second"] });

        expect(() => sourceConfigProbeResultSchema.parse({
            ...base,
            sampleTitles: ["1", "2", "3", "4"],
        })).toThrow();
        expect(() => sourceConfigProbeResultSchema.parse({
            ...base,
            sampleTitles: ["x".repeat(201)],
        })).toThrow();
    });

    it("pins the config probe job snapshot kind and result shape", () => {
        const job = {
            id: "job-1",
            kind: "source-config-probe",
            sourceId: null,
            runId: null,
            status: "queued",
            attempts: 0,
            maxAttempts: 3,
            errorCode: null,
            error: null,
            createdAt: "2026-08-24T00:00:00.000Z",
            updatedAt: "2026-08-24T00:00:00.000Z",
            result: null,
        };
        expect(sourceConfigProbeJobSnapshotSchema.parse(job)).toMatchObject({ kind: "source-config-probe" });
        expect(() => sourceConfigProbeJobSnapshotSchema.parse({ ...job, kind: "source-probe" })).toThrow();
        expect(() => sourceConfigProbeJobSnapshotSchema.parse({
            ...job,
            status: "succeeded",
            result: { itemCount: 1 },
        })).toThrow();
        expect(jobSnapshotSchema.parse(job)).toMatchObject({ kind: "source-config-probe" });
    });
});
