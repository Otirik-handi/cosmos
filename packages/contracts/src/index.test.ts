import { describe, expect, it } from "vitest";

import {
    aiHotSourceConfigSchema,
    bilibiliSourceConfigSchema,
    publisherSchema,
    createSourceCommandSchema,
    jobSnapshotSchema,
    sourceProbeResultSchema,
    temporalValueSchema,
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

    it("validates the public AI HOT configuration", () => {
        expect(aiHotSourceConfigSchema.parse({})).toMatchObject({
            schemaVersion: 1,
        });
        expect(() => aiHotSourceConfigSchema.parse({
            endpoint: "https://example.test",
        })).toThrow();
    });

    it("keeps source creation extensible while requiring built-in configs to be validated by their connector", () => {
        expect(createSourceCommandSchema.parse({
            name: "Bilibili hot",
            kind: "bilibili",
            config: {
                mode: "hot",
                limit: 10,
            },
        }).kind).toBe("bilibili");
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
