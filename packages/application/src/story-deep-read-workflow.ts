import { agentInvocationOutputSchema, normalizeReportInput } from "@cosmos/contracts";
import type { JsonValue, WorkflowDefinition } from "@notnotype/nb-workflow";
import { ActionExecutionError } from "./action.js";
import { storyDeepReadWorkflowInputSchema } from "./story-deep-read-preparation.js";
import { storyDeepReadWorkflowManifestHash } from "./story-deep-read-workflow-control.js";

export function createStoryDeepReadWorkflowDefinition(): WorkflowDefinition<JsonValue, JsonValue> & {
    inputSchema: typeof storyDeepReadWorkflowInputSchema; requiredActionRefs: readonly string[]; kind: "knowledge";
} {
    return { key: "cosmos.story-deep-read", version: "1", manifestHash: storyDeepReadWorkflowManifestHash, kind: "knowledge",
        requires: { durability: "durable", processRestart: true, concurrentExecution: true, multiWorker: true,
            leases: true, externalReceipts: true, valueReferences: true },
        inputSchema: storyDeepReadWorkflowInputSchema, requiredActionRefs: ["agent.invoke@2", "artifact.publish@1"],
        run: (workflow, raw) => runStoryDeepReadWorkflow(raw, (ref, input, options) => workflow.callAction(ref, input, options)) };
}
export async function runStoryDeepReadWorkflow(raw: unknown,
    callAction: (ref: string, input: JsonValue, options: { key: string }) => Promise<JsonValue>): Promise<JsonValue> {
            const snapshot = storyDeepReadWorkflowInputSchema.parse(raw);
            const rawOutput = await callAction("agent.invoke@2", json({ modelId: snapshot.resolvedModelId,
                messages: snapshot.messages, budget: snapshot.budget, tools: [] }), { key: "story.deep-read.invoke" });
            const parsed = agentInvocationOutputSchema.safeParse(rawOutput);
            if (!parsed.success) throw malformed();
            const output = parsed.data;
            if (output.finishReason === "length") throw new ActionExecutionError("budget_exhausted", "Story deep read output budget exhausted.", false);
            if (output.finishReason !== "stop" || output.toolCalls.length) throw malformed();
            let report: ReturnType<typeof normalizeReportInput>;
            try { report = normalizeReportInput(JSON.parse(output.content)); } catch { throw malformed(); }
            if (!report.success) throw malformed();
            for (const section of report.data.sections) for (const evidence of section.evidence) {
                if (!snapshot.input.sources.some((source) => !source.omitted && source.entryId === evidence.entryId
                    && source.entryRevisionId === evidence.entryRevisionId && source.representationVersion === evidence.representationVersion
                    && (evidence.blockId === undefined || source.blockIds.includes(evidence.blockId)))) throw malformed();
            }
            return callAction("artifact.publish@1", json({ ...report.data, producerVersion: "story-deep-read@1",
                provider: output.provider, model: output.model, usage: output.usage,
                ...(output.cost === undefined ? {} : { cost: output.cost }) }), { key: "story.deep-read.publish" });
}
function malformed(): ActionExecutionError { return new ActionExecutionError("malformed_payload", "Story deep read data invalid", false); }
function json(value: unknown): JsonValue { return JSON.parse(JSON.stringify(value)) as JsonValue; }
