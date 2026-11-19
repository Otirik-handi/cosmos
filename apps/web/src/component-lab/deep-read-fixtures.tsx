import { useMemo, useState } from "react";
import { z } from "zod";
import { deepReadGenerationSchema, storyDeepReadRevisionDetailSchema, type ArtifactRead, type DeepReadGeneration, type StoryDeepReadRevisionDetail } from "@cosmos/contracts";
import { CosmosTransportError } from "@cosmos/transport-http";
import { DeepReadPanel } from "@/components/cosmos/deep-read-panel";
import type { DeepReadClient } from "@/components/cosmos/story-panel/use-deep-read";
import type { LabProps } from "./types";

const date = "2026-11-19T08:00:00.000Z";
const evidence = { entryId: "lab-entry", entryRevisionId: "lab-revision", representationVersion: 2, blockId: "lab-block" };
export const deepReadScenes = ["idle", "generating", "failed", "conflict", "success", "long", "versions", "missing-evidence", "missing-block", "keyboard"] as const;

export function deepReadRevisionFixture(revision = 1, long = false): StoryDeepReadRevisionDetail {
    return storyDeepReadRevisionDetailSchema.parse({
        artifactId: "lab-artifact", storyId: "lab-story", workflowRunId: `lab-run-${revision}`, revision,
        headline: `深入阅读报告 ${revision}`, producer: "cosmos.story-deep-read", producerVersion: "1", provider: "lab-provider", model: "lab-model",
        createdAt: date, contentHash: "a".repeat(64), sourceStatus: revision === 1 ? "superseded" : "current",
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }, cost: { input: 0.1, output: 0.2, total: 0.3, currency: "USD" },
        sections: [{ id: "s1", heading: "事实与来源", kind: "fact", blocks: [
            { id: "s1-b1", type: "paragraph", data: { inlines: [{ type: "text", text: long ? "连续阅读的长报告正文。".repeat(300) : "报告正文保留，来源变化不会覆盖本版本。" }] } },
            { id: "s1-b2", type: "code", data: { text: "safe_text_".repeat(long ? 150 : 4) } },
        ], evidence: [evidence] }, { id: "s2", heading: "后续观察", kind: "opinion", blocks: [
            { id: "s2-b1", type: "paragraph", data: { inlines: [{ type: "text", text: "这是 Agent 的观点，需要结合来源判断。" }] } },
        ], evidence: [] }],
        input: { storyRevisionId: "lab-story-revision", sources: [{ ...evidence, blockId: undefined, blockIds: ["lab-block"], includedCharacterCount: 20, truncated: false, omitted: false, reason: null }].map(({ entryId, entryRevisionId, representationVersion, blockIds, includedCharacterCount, truncated, omitted, reason }) => ({ entryId, entryRevisionId, representationVersion, blockIds, includedCharacterCount, truncated, omitted, reason })), omittedSourceCount: 0 },
    });
}

const storeSchema = z.object({ generation: deepReadGenerationSchema.nullable(), revision: z.number().int(), count: z.number().int(), keys: z.record(z.string(), deepReadGenerationSchema) });
type Store = z.infer<typeof storeSchema>;

export function createDeepReadFixtureApi(scene: string, storyId: string, behavior: { hold: boolean; loseResponse: boolean }, onCount: (count: number) => void): DeepReadClient {
    const storageKey = `cosmos.lab.deep-read:${storyId}`;
    let initial: Store = { generation: null, revision: ["idle", "conflict"].includes(scene) ? 0 : 2, count: 0, keys: {} };
    const generation = (runId: string): DeepReadGeneration => ({ runId, storyId, status: "running", modelId: "lab-configured", provider: "lab-provider", model: "lab-model", createdAt: date, publishedRevision: null, errorCode: null });
    if (scene === "generating") initial.generation = generation("lab-existing");
    const load = () => {
        const raw = sessionStorage.getItem(storageKey);
        return raw ? storeSchema.parse(JSON.parse(raw)) : initial;
    };
    const save = (store: Store) => { initial = store; sessionStorage.setItem(storageKey, JSON.stringify(store)); onCount(store.count); };
    const detail = (revision: number) => ({ ...deepReadRevisionFixture(revision, scene === "long"), storyId,
        sourceStatus: scene === "missing-evidence" ? "unavailable" as const : revision === 1 ? "superseded" as const : "current" as const });
    return {
        async createStoryDeepRead(_id, _request, key) {
            const store = load();
            if (store.keys[key]) return store.keys[key];
            if (scene === "conflict" || store.generation?.status === "running") {
                store.generation ??= generation("lab-conflicting");
                save(store);
                throw new CosmosTransportError(409, { code: "conflict", message: "PRIVATE MUST NOT RENDER" });
            }
            store.count++;
            const value = generation(`lab-run-${store.count}`);
            store.generation = value;
            store.keys[key] = value;
            save(store);
            if (behavior.loseResponse) { behavior.loseResponse = false; throw new Error("Synthetic lost response"); }
            return value;
        },
        async storyDeepReadGeneration(_id, runId) {
            const store = load();
            const value = store.generation ?? generation(runId);
            if (value.status !== "running") return value;
            if (scene === "failed") { value.status = "failed"; value.errorCode = "timeout"; }
            else if (!behavior.hold) { value.status = "completed"; value.publishedRevision = store.revision + 1; store.revision++; }
            store.generation = value;
            for (const key of Object.keys(store.keys)) if (store.keys[key]?.runId === runId) store.keys[key] = value;
            save(store);
            return value;
        },
        async storyDeepReadArtifact(): Promise<ArtifactRead> {
            const store = load();
            onCount(store.count);
            if (!store.revision && !store.generation) return { artifact: null };
            const revisions = Array.from({ length: store.revision }, (_, index) => detail(store.revision - index));
            const summaries = revisions.map((revision) => {
                const { sections, input, ...summary } = revision;
                void sections;
                void input;
                return summary;
            });
            return { artifact: { id: "lab-artifact", storyId, kind: "story-deep-read", generation: store.generation?.status === "running" ? store.generation : null,
                current: store.revision ? detail(store.revision) : null, revisions: summaries } };
        },
        async storyDeepReadRevision(_id, revision) { return detail(revision); },
        async revisionContent(entryRevisionId, version) {
            if (scene === "missing-evidence") throw new CosmosTransportError(404, { code: "not_found" });
            if (entryRevisionId !== evidence.entryRevisionId || version !== evidence.representationVersion) throw new Error("Imprecise evidence read");
            return { entryId: evidence.entryId, entryRevisionId, readingMode: "representation", evidenceStatus: "available", contentText: "精确版本来源正文",
                representation: { id: "lab-representation", entryRevisionId, representationVersion: 2, parserVersion: "lab@1", status: "complete", createdAt: date, contentText: "精确版本来源正文",
                    blocks: [{ id: scene === "missing-block" ? "other-block" : evidence.blockId, type: "paragraph", data: { inlines: [{ type: "text", text: "精确版本来源正文" }] } }] } };
        },
    };
}

function DeepReadFixture({ scene }: { scene: string }) {
    const [hold, setHold] = useState(scene === "generating" || scene === "conflict");
    const [lost, setLost] = useState(false);
    const [count, setCount] = useState(0);
    const storyId = `lab-deep-read-${scene}`;
    const behavior = useMemo(() => ({ hold, loseResponse: lost }), [hold, lost]);
    const api = useMemo(() => createDeepReadFixtureApi(scene, storyId, behavior, setCount), [scene, storyId, behavior]);
    return <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap gap-4 text-sm">
            <label><input type="checkbox" checked={hold} onChange={(event) => setHold(event.target.checked)} />Hold generation</label>
            <label><input type="checkbox" checked={lost} onChange={(event) => setLost(event.target.checked)} />Lose enqueue response</label>
            <output aria-label="Generation count">{count}</output>
        </div>
        <DeepReadPanel storyId={storyId} api={api} />
    </div>;
}

export function renderDeepReadLab(props: LabProps) {
    const scene = String(props.state ?? "idle");
    return <DeepReadFixture key={scene} scene={scene} />;
}
