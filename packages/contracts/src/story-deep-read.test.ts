import { describe, expect, it } from "vitest";
import {
    artifactReadSchema, artifactSnapshotSchema, deepReadErrorCodeSchema, deepReadGenerationRequestSchema,
    deepReadGenerationSchema, deepReadLimits, deepReadRequestHashInputSchema, inputProjectionSchema,
    normalizeReportInput, reportBlockInputSchema, reportBlockSchema, reportInlineInputSchema,
    reportInputSchema, reportSectionInputSchema, reportSectionSchema, revisionSummarySchema,
    storyDeepReadRevisionDetailSchema, sourceStatusSchema,
} from "./index.js";

const reference = { entryId: "entry", entryRevisionId: "entry-revision", representationVersion: 1, blockId: "b1" };
const paragraph = () => ({ type: "paragraph", data: { inlines: [{ type: "text", text: "证据正文" }] } });
const section = () => ({ heading: "事实", kind: "fact", blocks: [paragraph()], evidence: [{ ...reference }] });
const report = () => ({ headline: "深入阅读", sections: [section()] });
const source = () => ({ ...reference, blockIds: ["b1"], includedCharacterCount: 12_000,
    truncated: false, omitted: false, reason: null });
function input() {
    const { blockId: _blockId, ...coverage } = source();
    return { storyRevisionId: "story-revision", sources: [coverage], omittedSourceCount: 0 };
}
const generation = () => ({ runId: "run", storyId: "story", status: "queued", modelId: "configured-model",
    provider: null, model: null, createdAt: "2026-11-19T00:00:00.000Z", publishedRevision: null, errorCode: null });
const summary = () => ({ artifactId: "artifact", storyId: "story", workflowRunId: "run", revision: 1,
    headline: "深入阅读", producer: "agent", producerVersion: "1", provider: "provider", model: "actual-model",
    createdAt: "2026-11-19T00:00:00.000Z", contentHash: "a".repeat(64), sourceStatus: "current" });
function sections() {
    const result = normalizeReportInput(report());
    if (!result.success) throw new Error("Invalid test fixture");
    return result.data.sections;
}
const detail = () => ({ ...summary(), sections: sections(), input: input() });
const artifact = () => ({ id: "artifact", storyId: "story", kind: "story-deep-read", generation: null,
    revisions: [summary()], current: detail() });

// Every public boundary rejects unknown data rather than silently stripping it.
describe("deep-read strict public contracts", () => {
    it.each([
        ["request", deepReadGenerationRequestSchema, { modelId: "model" }],
        ["generation", deepReadGenerationSchema, generation()],
        ["read", artifactReadSchema, { artifact: artifact() }],
        ["snapshot", artifactSnapshotSchema, artifact()],
        ["summary", revisionSummarySchema, summary()],
        ["detail", storyDeepReadRevisionDetailSchema, detail()],
        ["section", reportSectionSchema, sections()[0]],
        ["block", reportBlockSchema, sections()[0]?.blocks[0]],
        ["input", inputProjectionSchema, input()],
        ["report input", reportInputSchema, report()],
        ["section input", reportSectionInputSchema, section()],
        ["block input", reportBlockInputSchema, paragraph()],
        ["inline input", reportInlineInputSchema, { type: "text", text: "ok" }],
        ["hash input", deepReadRequestHashInputSchema, { storyId: "story", modelId: null }],
    ] as const)("%s has a positive and strict negative example", (_name, schema, value) => {
        expect(schema.safeParse(value).success).toBe(true);
        expect(schema.safeParse({ ...value, secret: "forbidden" }).success).toBe(false);
    });
    it("supports both empty artifact states and only actual model selection in requests", () => {
        expect(artifactReadSchema.parse({ artifact: null })).toEqual({ artifact: null });
        expect(artifactSnapshotSchema.safeParse({ ...artifact(), current: null, revisions: [], generation: generation() }).success).toBe(true);
        expect(deepReadGenerationRequestSchema.parse({ modelId: " model " })).toEqual({ modelId: "model" });
        expect(deepReadGenerationRequestSchema.parse({})).toEqual({});
        for (const value of [null, " ", "m".repeat(201)]) expect(deepReadGenerationRequestSchema.safeParse({ modelId: value }).success).toBe(false);
        expect(deepReadGenerationRequestSchema.safeParse({ modelId: "m".repeat(200) }).success).toBe(true);
    });
    it("defines hash input as original request model/null without resolved defaults or content", () => {
        expect(deepReadRequestHashInputSchema.parse({ storyId: "story", modelId: null })).toEqual({ storyId: "story", modelId: null });
        expect(deepReadRequestHashInputSchema.parse({ storyId: "story", modelId: " original " }).modelId).toBe("original");
        for (const value of [{ storyId: "story" }, { storyId: "story", modelId: null, prompt: "body" },
            { storyId: "story", modelId: null, resolvedModelId: "default" }]) {
            expect(deepReadRequestHashInputSchema.safeParse(value).success).toBe(false);
        }
    });
    it("uses only safe errors and source status values", () => {
        for (const code of ["timeout", "authentication_required", "rate_limited", "budget_exhausted", "invalid_configuration",
            "dependency_unavailable", "malformed_payload", "generation_failed"]) expect(deepReadErrorCodeSchema.safeParse(code).success).toBe(true);
        expect(deepReadErrorCodeSchema.safeParse("provider stack trace").success).toBe(false);
        for (const status of ["current", "superseded", "unavailable"]) expect(sourceStatusSchema.safeParse(status).success).toBe(true);
        expect(sourceStatusSchema.safeParse("deleted").success).toBe(false);
    });
    it("keeps successful publication, safe failure and optional historical cost consistent", () => {
        const cost = { input: 0, output: 0, total: 0, currency: "USD" };
        expect(deepReadGenerationSchema.safeParse({ ...generation(), status: "completed", publishedRevision: 1, cost }).success).toBe(true);
        expect(deepReadGenerationSchema.safeParse({ ...generation(), status: "failed", errorCode: "timeout" }).success).toBe(true);
        for (const bad of [{ status: "completed" }, { cost }, { errorCode: "timeout" }, { publishedRevision: 1 }]) {
            expect(deepReadGenerationSchema.safeParse({ ...generation(), ...bad }).success).toBe(false);
        }
        expect(revisionSummarySchema.safeParse({ ...summary(), cost, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }).success).toBe(true);
        for (const value of [-1, Infinity, NaN]) expect(revisionSummarySchema.safeParse({ ...summary(), cost: { ...cost, total: value } }).success).toBe(false);
        expect(revisionSummarySchema.safeParse({ ...summary(), cost: { ...cost, raw: "secret" } }).success).toBe(false);
        expect(revisionSummarySchema.safeParse({ ...summary(), usage: { inputTokens: -1, outputTokens: 0, totalTokens: 0 } }).success).toBe(false);
        expect(revisionSummarySchema.safeParse({ ...summary(), sections: [] }).success).toBe(false);
    });
    it.each(["USD", "CNY"])("preserves the configured %s currency in published cost", (currency) => {
        const cost = { input: 0, output: 0, total: 0, currency };
        expect(deepReadGenerationSchema.parse({ ...generation(), status: "completed", publishedRevision: 1, cost }).cost).toEqual(cost);
        expect(revisionSummarySchema.parse({ ...summary(), cost }).cost).toEqual(cost);
        expect(storyDeepReadRevisionDetailSchema.parse({ ...detail(), cost }).cost).toEqual(cost);
    });
    it("rejects unsupported or absent currencies without adding a default", () => {
        for (const currency of ["", "EUR", "usd", null, undefined]) {
            const cost = { input: 0, output: 0, total: 0, ...(currency === undefined ? {} : { currency }) };
            expect(deepReadGenerationSchema.safeParse({ ...generation(), status: "completed", publishedRevision: 1, cost }).success).toBe(false);
            expect(revisionSummarySchema.safeParse({ ...summary(), cost }).success).toBe(false);
            expect(storyDeepReadRevisionDetailSchema.safeParse({ ...detail(), cost }).success).toBe(false);
        }
    });
    it("bounds identifiers, positive safe integers, hashes, dates and revision summaries", () => {
        expect(deepReadGenerationSchema.safeParse({ ...generation(), runId: "r".repeat(200) }).success).toBe(true);
        for (const runId of ["", "r".repeat(201)]) expect(deepReadGenerationSchema.safeParse({ ...generation(), runId }).success).toBe(false);
        for (const revision of [0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1]) expect(revisionSummarySchema.safeParse({ ...summary(), revision }).success).toBe(false);
        for (const contentHash of ["A".repeat(64), "a".repeat(63)]) expect(revisionSummarySchema.safeParse({ ...summary(), contentHash }).success).toBe(false);
        expect(revisionSummarySchema.safeParse({ ...summary(), createdAt: "today" }).success).toBe(false);
        const revisions = Array.from({ length: 50 }, (_, index) => ({ ...summary(), revision: 50 - index }));
        const snapshot = { ...artifact(), revisions, current: { ...detail(), revision: 50 } };
        expect(artifactSnapshotSchema.safeParse(snapshot).success).toBe(true);
        expect(artifactSnapshotSchema.safeParse({ ...snapshot, revisions: [...revisions, { ...summary(), revision: 1 }] }).success).toBe(false);
        expect(artifactSnapshotSchema.safeParse({ ...snapshot, revisions: [...revisions].reverse() }).success).toBe(false);
        expect(artifactSnapshotSchema.safeParse({ ...artifact(), generation: { ...generation(), status: "cancelled" } }).success).toBe(false);
        expect(artifactSnapshotSchema.safeParse({ ...artifact(), current: { ...detail(), storyId: "other" } }).success).toBe(false);
    });
});

describe("bounded model output and deterministic publication", () => {
    it("numbers every nested block depth-first, resets per section, and never mutates input", () => {
        const model = { headline: " 标题 ", sections: [{ ...section(), blocks: [{ type: "quote", data: { blocks: [
            { type: "list", data: { ordered: false, items: [{ inlines: [], blocks: [paragraph()] }] } }, paragraph(),
        ] } }, paragraph()] }, { ...section(), kind: "opinion", evidence: [] }] };
        const before = structuredClone(model);
        const result = normalizeReportInput(model);
        expect(result).toEqual(normalizeReportInput(structuredClone(model)));
        expect(model).toEqual(before);
        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.headline).toBe("标题");
        const ids: string[] = [];
        const visit = (value: unknown): void => {
            if (!value || typeof value !== "object") return;
            if ("id" in value && typeof value.id === "string") ids.push(value.id);
            for (const child of Object.values(value)) visit(child);
        };
        visit(result.data.sections);
        expect(ids).toEqual(["s1", "s1-b1", "s1-b2", "s1-b3", "s1-b4", "s1-b5", "s2", "s2-b1"]);
    });
    it("requires fact evidence and bounds section/title/evidence counts", () => {
        expect(reportSectionInputSchema.safeParse({ ...section(), evidence: [] }).success).toBe(false);
        expect(reportSectionInputSchema.safeParse({ ...section(), kind: "opinion", evidence: [] }).success).toBe(true);
        expect(reportSectionInputSchema.safeParse({ ...section(), heading: "h".repeat(200), evidence: Array.from({ length: 30 }, () => ({ ...reference })) }).success).toBe(true);
        for (const bad of [{ heading: "h".repeat(201) }, { heading: "<b>HTML</b>" },
            { evidence: Array.from({ length: 31 }, () => ({ ...reference })) }, { evidence: [{ ...reference, representationVersion: 0 }] },
            { evidence: [{ ...reference, entryId: "x".repeat(201) }] }]) expect(reportSectionInputSchema.safeParse({ ...section(), ...bad }).success).toBe(false);
        expect(reportInputSchema.safeParse({ headline: "h".repeat(300), sections: Array.from({ length: 8 }, section) }).success).toBe(true);
        expect(normalizeReportInput({ ...report(), headline: "h".repeat(301) }).success).toBe(false);
        expect(normalizeReportInput({ ...report(), sections: Array.from({ length: 9 }, section) }).success).toBe(false);
    });
    it.each(["heading", "image", "audio", "video", "media", "embed", "table", "html", "source", "warnings"])("rejects nested forbidden type %s", (type) => {
        expect(normalizeReportInput({ ...report(), sections: [{ ...section(), blocks: [{ type: "quote", data: { blocks: [{ type, data: {} }] } }] }] }).success).toBe(false);
    });
    it("rejects unknown fields/IDs at every model depth and published source/warnings recursively", () => {
        for (const block of [{ ...paragraph(), id: "model-id" }, { ...paragraph(), source: "url" },
            { ...paragraph(), data: { ...paragraph().data, html: "<b>x</b>" } },
            { type: "paragraph", data: { inlines: [{ type: "text", text: "x", raw: true }] } }]) {
            expect(normalizeReportInput({ ...report(), sections: [{ ...section(), blocks: [block] }] }).success).toBe(false);
        }
        for (const forbidden of [{ source: "url" }, { warnings: [] }]) {
            expect(reportBlockSchema.safeParse({ id: "s1-b1", type: "quote", data: { blocks: [{ id: "s1-b2", ...paragraph(), ...forbidden }] } }).success).toBe(false);
        }
        expect(reportSectionInputSchema.safeParse({ ...section(), id: "s1" }).success).toBe(false);
    });
    it("allows all inline types and http(s), rejects other protocols and excess text/arrays", () => {
        for (const value of [{ type: "text", text: "x" }, { type: "code", text: "x" },
            { type: "link", text: "x", url: "https://example.com" },
            { type: "strong", inlines: [{ type: "emphasis", inlines: [{ type: "text", text: "x" }] }] }]) {
            expect(reportInlineInputSchema.safeParse(value).success).toBe(true);
        }
        for (const link of ["javascript:alert(1)", "data:text/html,x", "file:///tmp/x", "https://example.com/" + "x".repeat(4096)]) {
            expect(reportInlineInputSchema.safeParse({ type: "link", text: "x", url: link }).success).toBe(false);
        }
        expect(reportInlineInputSchema.safeParse({ type: "text", text: "x".repeat(65536) }).success).toBe(true);
        expect(reportInlineInputSchema.safeParse({ type: "text", text: "x".repeat(65537) }).success).toBe(false);
        expect(reportInlineInputSchema.safeParse({ type: "strong", inlines: Array.from({ length: 101 }, () => ({ type: "text", text: "x" })) }).success).toBe(false);
    });
    it("counts nested blocks globally and permits at most two quote/list containers", () => {
        const quote = (blocks: unknown[]) => ({ type: "quote", data: { blocks } });
        expect(reportBlockInputSchema.safeParse(quote([quote([paragraph()])])).success).toBe(true);
        expect(reportBlockInputSchema.safeParse(quote([quote([quote([paragraph()])])])).success).toBe(false);
        const model = { ...report(), sections: [{ ...section(), blocks: [quote(Array.from({ length: 59 }, paragraph))] }] };
        expect(normalizeReportInput(model).success).toBe(true);
        expect(normalizeReportInput({ ...report(), sections: [{ ...section(), blocks: [quote(Array.from({ length: 60 }, paragraph))] }] }).success).toBe(false);
        expect(normalizeReportInput({ ...report(), sections: Array.from({ length: 2 }, () => ({ ...section(), blocks: Array.from({ length: 31 }, paragraph) })) }).success).toBe(false);
    });
    it("rejects accessors without invoking either valid-looking or throwing getters", () => {
        let reads = 0;
        for (const throwing of [false, true]) {
            const model = report();
            Object.defineProperty(model, "headline", { enumerable: true, get() {
                reads++;
                if (throwing) throw new Error("private getter detail");
                return "valid-looking headline";
            } });
            expect(normalizeReportInput(model)).toMatchObject({ success: false, errorCode: "malformed_payload" });
            expect(reportInputSchema.safeParse(model).success).toBe(false);
        }
        expect(reads).toBe(0);
    });
    it("rejects serialization hooks without invoking them or hiding oversized content", () => {
        let calls = 0;
        const model = { ...report(), sections: [{ ...section(), blocks: Array.from({ length: 2 }, () => ({
            type: "code", data: { text: "汉".repeat(40_000) },
        })) }] };
        for (const enumerable of [false, true]) {
            Object.defineProperty(model, "toJSON", { configurable: true, enumerable, value() {
                calls++;
                return { headline: "hidden", sections: [] };
            } });
            expect(normalizeReportInput(model)).toMatchObject({ success: false, errorCode: "malformed_payload" });
        }
        const published = detail();
        Object.defineProperty(published, "toJSON", { value() { calls++; throw new Error("private serializer detail"); } });
        expect(storyDeepReadRevisionDetailSchema.safeParse(published).success).toBe(false);
        expect(calls).toBe(0);
    });
    it("converts revoked proxies and failing reflection traps into schema failures", () => {
        const revocable = Proxy.revocable(report(), {});
        revocable.revoke();
        const throwing = new Proxy(report(), { ownKeys() { throw new Error("private reflection detail"); } });
        for (const value of [revocable.proxy, throwing]) {
            const result = normalizeReportInput(value);
            expect(result).toMatchObject({ success: false, errorCode: "malformed_payload" });
            expect(reportInputSchema.safeParse(value).success).toBe(false);
            expect(JSON.stringify(result)).not.toContain("private");
        }
    });
    it("returns discriminated failures for UTF-8 byte overflow, cycles and hostile depth", () => {
        const huge = { ...report(), sections: [{ ...section(), blocks: Array.from({ length: 2 }, () => ({ type: "code", data: { text: "汉".repeat(40_000) } })) }] };
        expect(JSON.stringify(huge).length).toBeLessThan(deepReadLimits.maxJsonBytes);
        expect(normalizeReportInput(huge)).toMatchObject({ success: false, errorCode: "malformed_payload" });
        const cyclic: { type: string; inlines: unknown[] } = { type: "strong", inlines: [] };
        cyclic.inlines.push(cyclic);
        expect(reportInlineInputSchema.safeParse(cyclic).success).toBe(false);
        let nested: unknown = { type: "text", text: "x" };
        for (let i = 0; i < 1000; i++) nested = { type: "strong", inlines: [nested] };
        expect(reportInlineInputSchema.safeParse(nested).success).toBe(false);
        expect(storyDeepReadRevisionDetailSchema.safeParse({ ...detail(), sections: [{ id: "s1", ...section(), blocks: [{ id: "s1-b1", type: "code", data: { text: "汉".repeat(65_536) } }, { id: "s1-b2", type: "code", data: { text: "汉".repeat(65_536) } }] }] }).success).toBe(false);
    });
});

describe("input coverage projection", () => {
    it("enforces eight sources, 12k per source, 60k total, 5000 unique bounded IDs", () => {
        const coverage = input().sources[0]!;
        expect(inputProjectionSchema.safeParse({ ...input(), sources: Array.from({ length: 5 }, () => ({ ...coverage })) }).success).toBe(true);
        expect(inputProjectionSchema.safeParse({ ...input(), sources: Array.from({ length: 6 }, () => ({ ...coverage })) }).success).toBe(false);
        expect(inputProjectionSchema.safeParse({ ...input(), sources: Array.from({ length: 8 }, () => ({ ...coverage, includedCharacterCount: 1 })) }).success).toBe(true);
        expect(inputProjectionSchema.safeParse({ ...input(), sources: Array.from({ length: 9 }, () => ({ ...coverage, includedCharacterCount: 1 })) }).success).toBe(false);
        for (const patch of [{ includedCharacterCount: 12001 }, { blockIds: ["b", "b"] }, { blockIds: ["x".repeat(201)] },
            { blockIds: Array.from({ length: 5001 }, (_, i) => `b${i}`) }]) {
            expect(inputProjectionSchema.safeParse({ ...input(), sources: [{ ...coverage, ...patch }] }).success).toBe(false);
        }
        expect(inputProjectionSchema.safeParse({ ...input(), sources: [{ ...coverage, blockIds: Array.from({ length: 5000 }, (_, i) => `b${i}`) }] }).success).toBe(true);
    });
    it("records omitted unavailable representations without inventing a version or usable blocks", () => {
        const coverage = input().sources[0]!;
        expect(inputProjectionSchema.safeParse(input()).success).toBe(true);
        const omitted = { ...coverage, entryId: "unavailable-entry", entryRevisionId: "unavailable-revision",
            representationVersion: null, omitted: true, blockIds: [], includedCharacterCount: 0, reason: "unavailable" };
        const parsed = inputProjectionSchema.parse({ ...input(), sources: [coverage, omitted], omittedSourceCount: 1 });
        expect(parsed.sources[1]).toMatchObject({ representationVersion: null, blockIds: [], includedCharacterCount: 0 });
        expect(parsed.sources.filter((source) => !source.omitted).map((source) => source.entryId)).not.toContain(omitted.entryId);
        // Input projection records availability; downstream frozen-allowlist validation owns evidence membership.
        expect(parsed.sources[1]?.blockIds).not.toContain(reference.blockId);
        expect(inputProjectionSchema.safeParse({ ...input(), sources: [coverage,
            { ...omitted, representationVersion: 2, reason: "budget" }], omittedSourceCount: 1 }).success).toBe(true);
        expect(inputProjectionSchema.safeParse({ ...input(), sources: [{ ...coverage, representationVersion: null }] }).success).toBe(false);
        for (const patch of [{ blockIds: ["b1"] }, { includedCharacterCount: 1 }, { reason: null }, { reason: undefined },
            { representationVersion: 0 }, { representationVersion: -1 }, { representationVersion: 1.5 }]) {
            expect(inputProjectionSchema.safeParse({ ...input(), sources: [coverage, { ...omitted, ...patch }],
                omittedSourceCount: 1 }).success).toBe(false);
        }
    });
    it("keeps omitted/truncated refs and statistics coherent without body or prompt fields", () => {
        const coverage = input().sources[0]!;
        const omitted = { ...coverage, omitted: true, includedCharacterCount: 0, blockIds: [], reason: "unavailable" };
        expect(inputProjectionSchema.safeParse({ ...input(), sources: [coverage, omitted], omittedSourceCount: 1 }).success).toBe(true);
        expect(inputProjectionSchema.safeParse({ ...input(), sources: [{ ...coverage, truncated: true, reason: "budget" }] }).success).toBe(true);
        for (const patch of [{ omitted: true }, { includedCharacterCount: 0 }, { blockIds: [] }, { reason: "unknown" },
            { truncated: true }, { prompt: "body" }, { contentText: "body" }]) {
            expect(inputProjectionSchema.safeParse({ ...input(), sources: [{ ...coverage, ...patch }] }).success).toBe(false);
        }
        expect(inputProjectionSchema.safeParse({ ...input(), sources: [omitted], omittedSourceCount: 1 }).success).toBe(false);
        expect(inputProjectionSchema.safeParse({ ...input(), omittedSourceCount: -1 }).success).toBe(false);
    });
});
