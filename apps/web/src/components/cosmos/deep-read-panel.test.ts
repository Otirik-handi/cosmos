import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CosmosTransportError } from "@cosmos/transport-http";
import { Dialog } from "@/components/ui/dialog";
import { createDeepReadFixtureApi, deepReadRevisionFixture } from "@/component-lab/deep-read-fixtures";
import { deepReadHttpError } from "./story-panel/use-deep-read";
import { DeepReadReport } from "./deep-read-panel";

function renderReport(old = false) {
    return renderToStaticMarkup(createElement(Dialog, {}, createElement(DeepReadReport, {
        revision: deepReadRevisionFixture(), old, onEvidence: vi.fn(),
    })));
}
afterEach(() => vi.unstubAllGlobals());

describe("deep read report", () => {
    it("renders immutable provenance, source status, opinion, cost and evidence actions", () => {
        const html = renderReport(true);
        for (const text of ["旧版本", "只读", "来源已更新", "Agent 观点", "lab-provider / lab-model", "实际成本", "0.3 USD", "来源证据 1"]) expect(html).toContain(text);
        expect(html).toContain('data-content-block="paragraph"');
        expect(html).toContain('data-content-block="code"');
        expect(html).not.toContain("<img");
        expect(html).not.toContain("<iframe");
    });
    it("renders current without changing or editing the report", () => {
        const html = renderReport();
        expect(html).toContain("当前版本");
        expect(html).not.toContain("<textarea");
        expect(html).not.toContain("contenteditable");
    });
    it.each([400, 404, 409, 503, 500])("uses fixed safe copy for HTTP %s", (status) => {
        const copy = deepReadHttpError(new CosmosTransportError(status, { message: "PRIVATE_PROVIDER_DETAIL" }));
        expect(copy).not.toContain("PRIVATE_PROVIDER_DETAIL");
        expect(copy.length).toBeGreaterThan(5);
        if (status === 409) expect(copy).toBe("该 Story 已有进行中的深入阅读");
    });
    it("fixture replays keys, preserves terminal revisions and uses precise evidence reads", async () => {
        const store = new Map<string, string>();
        vi.stubGlobal("sessionStorage", { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) });
        const count = vi.fn();
        const api = createDeepReadFixtureApi("idle", "story", { hold: false, loseResponse: false }, count);
        const queued = await api.createStoryDeepRead("story", {}, "same-key");
        expect(await api.createStoryDeepRead("story", {}, "same-key")).toEqual(queued);
        const completed = await api.storyDeepReadGeneration("story", queued.runId);
        expect(completed).toMatchObject({ status: "completed", publishedRevision: 1 });
        expect(await api.storyDeepReadGeneration("story", queued.runId)).toEqual(completed);
        const artifact = (await api.storyDeepReadArtifact("story")).artifact;
        expect(artifact?.revisions).toHaveLength(1);
        expect(artifact?.current?.revision).toBe(1);
        expect((await api.revisionContent("lab-revision", 2)).representation?.representationVersion).toBe(2);
        await expect(api.revisionContent("lab-revision", 1)).rejects.toThrow("Imprecise evidence read");
    });
});
