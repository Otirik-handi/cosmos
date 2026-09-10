import { describe, expect, it } from "vitest";

import {
    cancelRunCommandSchema,
    recoverRunCommandSchema,
    rerunRunCommandSchema,
    runControlResultSchema,
} from "./index.js";

const runSnapshot = {
    id: "run-1",
    sourceId: "source-1",
    triggerKind: "manual",
    status: "cancelled",
    createdAt: "2026-09-10T00:00:00.000Z",
    startedAt: "2026-09-10T00:00:01.000Z",
    finishedAt: "2026-09-10T00:00:02.000Z",
    itemCount: 0,
    createdEntryCount: 0,
    revisedEntryCount: 0,
    error: null,
};

describe("Run control contracts (RUN-004 / ADR-0016)", () => {
    it("accepts an empty cancel/recover command and an optional reason", () => {
        expect(cancelRunCommandSchema.parse({})).toEqual({});
        expect(cancelRunCommandSchema.parse({ reason: "用户取消" })).toEqual({ reason: "用户取消" });
        expect(recoverRunCommandSchema.parse({})).toEqual({});
    });

    it("rejects unknown fields on the strict run control commands", () => {
        expect(() => cancelRunCommandSchema.parse({ force: true })).toThrow();
        expect(() => rerunRunCommandSchema.parse({ retry: true })).toThrow();
    });

    it("validates a run control result with the stable RunSnapshot plus explanations", () => {
        const result = runControlResultSchema.parse({
            action: "cancelled",
            run: runSnapshot,
            reuse: "已入库内容保留",
            sideEffects: "取消是终态",
        });
        expect(result.action).toBe("cancelled");
        expect(result.run.status).toBe("cancelled");
    });

    it("rejects a run control result missing the explanation fields", () => {
        expect(() => runControlResultSchema.parse({ action: "rerun", run: runSnapshot })).toThrow();
    });
});
