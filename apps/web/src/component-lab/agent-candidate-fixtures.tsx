import { useMemo, useState } from "react";
import type { StoryAgentCandidateRecordContract } from "@cosmos/contracts";
import { StoryAgentCandidatesPanel } from "@/components/cosmos/story-panel/agent-candidates";
import { storyLabFixture } from "./product-fixtures";

export function AgentCandidateFixture() {
    const [unsaved, setUnsaved] = useState(false);
    const [accepted, setAccepted] = useState(false);
    const story = useMemo(() => storyLabFixture("splittable", "候选验收文章", "现有摘要"), []);
    const api = useMemo(() => {
        const records: StoryAgentCandidateRecordContract[] = [];
        return {
            async storyAgentCandidates() { return [...records]; },
            async revisionContent(revisionId: string) {
                return { entryId: "lab-entry", entryRevisionId: revisionId, representation: null, contentText: "", readingMode: "unavailable" as const, evidenceStatus: "available" as const };
            },
            async proposeStoryAgentCandidate() {
                const record: StoryAgentCandidateRecordContract = { status: "pending", candidate: {
                    id: `candidate-${records.length}`, storyId: story.story.id, storyRevisionId: story.story.revisionId,
                    producer: "agent", producerVersion: "lab@1", provider: "fixture", model: "fixture",
                    inputSources: [], confidence: null, createdAt: "2026-10-08T12:00:00.000Z",
                    proposal: { task: "story.summarize", title: "建议标题", summary: "建议摘要 <script>不会执行</script>", keyFacts: [] },
                } };
                records.unshift(record);
                return record;
            },
            async decideStoryAgentCandidate(id: string, decision: "accept" | "reject") {
                const record = records.find((item) => item.candidate.id === id)!;
                if (record.status !== "pending") throw new Error("候选已经处理");
                record.status = decision === "accept" ? "accepted" : "rejected";
                return { ...record };
            },
        };
    }, [story]);
    return <div className="space-y-4">
        <label><input type="checkbox" checked={unsaved} onChange={(event) => setUnsaved(event.target.checked)} />模拟未保存编辑</label>
        {accepted && <p role="status">已刷新 Story</p>}
        <StoryAgentCandidatesPanel story={story} unsavedEdit={unsaved} api={api} onAccepted={async () => { setAccepted(true); }} />
    </div>;
}
