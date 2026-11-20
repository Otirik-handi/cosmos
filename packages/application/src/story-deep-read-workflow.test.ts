import { describe, expect, it, vi } from "vitest";
import type { JsonValue } from "@notnotype/nb-workflow";
import { agentInvocationOutputSchema } from "@cosmos/contracts";
import { ActionRegistry } from "./action.js";
import { activityJob, runLease } from "./workflow-host-runtime.fixtures.js";
import { runStoryDeepReadWorkflow, createStoryDeepReadWorkflowDefinition } from "./story-deep-read-workflow.js";
import { createStoryDeepReadPublishAction } from "./story-deep-read-publish.js";
import type { StoryDeepReadSnapshot } from "./story-deep-read-preparation.js";

const snapshot: StoryDeepReadSnapshot = { kind: "story-deep-read", storyId: "story", resolvedModelId: "model",
    messages: [{ role: "user", content: "trusted host prompt with untrusted evidence" }],
    budget: { maxDurationMs: 5000, maxToolCalls: 0, maxOutputTokens: 6000 }, input: { storyRevisionId: "sr", omittedSourceCount: 1,
        sources: [{ entryId: "e", entryRevisionId: "r", representationVersion: 2, blockIds: ["b"], includedCharacterCount: 5,
            omitted: false, truncated: false, reason: null },
        { entryId: "missing", entryRevisionId: "missing-r", representationVersion: null, blockIds: [], includedCharacterCount: 0,
            omitted: true, truncated: false, reason: "unavailable" }] } };
const report = { headline: "Report", sections: [{ heading: "Facts", kind: "fact", blocks: [
    { type: "paragraph", data: { inlines: [{ type: "text", text: "A fact" }] } }],
    evidence: [{ entryId: "e", entryRevisionId: "r", representationVersion: 2, blockId: "b" }] }] };
const output = agentInvocationOutputSchema.parse({ content: JSON.stringify(report), toolCalls: [],
    provider: "fake", model: "actual-model", finishReason: "stop", usage: { inputTokens: 5, outputTokens: 9, totalTokens: 14 },
    cost: { input: 0.1, output: 0.2, total: 0.3, currency: "USD" } });
function execute(value: unknown) {
    const invoke = vi.fn(async () => JSON.parse(JSON.stringify(value)) as JsonValue);
    const publish = vi.fn(async (input: JsonValue) => input);
    const result = runStoryDeepReadWorkflow(snapshot, async (ref, input) => {
        if (ref === "agent.invoke@2") { expect(input).toMatchObject({ modelId: "model", messages: snapshot.messages,
            budget: snapshot.budget, tools: [] }); return invoke(); }
        if (ref === "artifact.publish@1") return publish(input);
        throw new Error("unexpected action");
    });
    return { result, invoke, publish };
}

describe("deep read workflow", () => {
    it("normalizes valid output, publishes once, and preserves usage/cost", async () => {
        const f = execute(output);
        await expect(f.result).resolves.toMatchObject({ headline: "Report", sections: [{ id: "s1", blocks: [{ id: "s1-b1" }] }],
            producerVersion: "story-deep-read@1", provider: "fake", model: "actual-model", usage: output.usage, cost: output.cost });
        expect(f.invoke).toHaveBeenCalledOnce(); expect(f.publish).toHaveBeenCalledOnce();
        const definition = createStoryDeepReadWorkflowDefinition();
        expect(definition).toMatchObject({ key: "cosmos.story-deep-read", version: "1", kind: "knowledge",
            requiredActionRefs: ["agent.invoke@2", "artifact.publish@1"] });
    });
    it.each([
        ["invalid JSON", { ...output, content: "PRIVATE_PROVIDER_RESPONSE" }, "malformed_payload"],
        ["tool call", { ...output, toolCalls: [{ name: "unexpected", arguments: {} }] }, "malformed_payload"],
        ["length", { ...output, finishReason: "length" }, "budget_exhausted"],
        ["non-stop", { ...output, finishReason: "tool_call" }, "malformed_payload"],
        ["malformed blocks", { ...output, content: JSON.stringify({ headline: "x", sections: [{ heading: "x", kind: "opinion", evidence: [], blocks: [{ type: "image", data: {} }] }] }) }, "malformed_payload"],
        ["fact without evidence", { ...output, content: JSON.stringify({ ...report, sections: [{ ...report.sections[0], evidence: [] }] }) }, "malformed_payload"],
        ["foreign block", { ...output, content: JSON.stringify({ ...report, sections: [{ ...report.sections[0], evidence: [{ entryId: "e", entryRevisionId: "r", representationVersion: 2, blockId: "foreign" }] }] }) }, "malformed_payload"],
        ["omitted source", { ...output, content: JSON.stringify({ ...report, sections: [{ ...report.sections[0], evidence: [{ entryId: "missing", entryRevisionId: "missing-r", representationVersion: 1 }] }] }) }, "malformed_payload"],
    ])("rejects %s without publishing or leaking output", async (_name, value, code) => {
        const f = execute(value);
        await expect(f.result).rejects.toMatchObject({ code, retryable: false });
        await expect(f.result).rejects.not.toThrow("PRIVATE_PROVIDER_RESPONSE");
        expect(f.publish).not.toHaveBeenCalled();
    });
    it("supports a valid opinion without evidence and leaves unknown costs absent", async () => {
        const { cost: _cost, ...noCost } = output;
        const f = execute({ ...noCost, content: JSON.stringify({ headline: "Opinion", sections: [{ heading: "View", kind: "opinion", evidence: [], blocks: [] }] }) });
        expect(await f.result).not.toHaveProperty("cost");
        expect(f.publish).toHaveBeenCalledOnce();
    });
});

describe("artifact publish host action", () => {
    const job = activityJob();
    const fence = { workflowRunId: runLease.runId, kernelRevision: 1, activity: job.payload.activity, jobId: job.id,
        attempt: 1, jobLeaseToken: "job-token", runLeaseToken: "run-token" };
    it("uses only host run identity and fence, declares one attempt, and sanitizes storage failures", async () => {
        const publishStoryDeepReadRevision = vi.fn(async (_input: import("./story-deep-read-store.js").PublishStoryDeepReadRevisionInput) => { throw new Error("PRIVATE_DATABASE_ERROR"); });
        const action = createStoryDeepReadPublishAction({ publishStoryDeepReadRevision });
        expect(action.definition).toMatchObject({ ref: "artifact.publish@1", kind: "artifact", executionPlacement: "host",
            execution: { retryPolicy: { maxAttempts: 1 } } });
        const generated = await execute(output).result;
        const registry = new ActionRegistry([action]);
        await expect(registry.dispatchHost("artifact.publish@1", generated, { idempotencyKey: "publish", signal: new AbortController().signal }, fence))
            .rejects.toMatchObject({ code: "malformed_payload", message: "Story deep read publication failed.", retryable: false });
        expect(publishStoryDeepReadRevision).toHaveBeenCalledOnce();
        expect(publishStoryDeepReadRevision.mock.calls[0]?.[0]).toMatchObject({ workflowRunId: runLease.runId, fence,
            provider: "fake", model: "actual-model", usage: output.usage, cost: output.cost });
        expect(action.definition.inputSchema.safeParse({ ...generated as object, storyId: "forged", producer: "human", input: {} }).success).toBe(false);
    });
});
