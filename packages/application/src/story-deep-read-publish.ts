import { z } from "zod";
import { agentInvocationOutputSchema, storyDeepReadRevisionDetailSchema, reportSectionSchema, type ActionDefinition } from "@cosmos/contracts";
import { ActionExecutionError, type HostActionExecutionContext, type RegisteredAction } from "./action.js";
import type { StoryDeepReadStore } from "./story-deep-read-store.js";

export const storyDeepReadPublishInputSchema = z.object({
    headline: z.string().trim().min(1).max(300),
    sections: z.array(reportSectionSchema).min(1).max(8), producerVersion: z.string().min(1).max(200),
    provider: z.string().min(1).max(200), model: z.string().min(1).max(200),
    usage: agentInvocationOutputSchema.shape.usage.optional(), cost: agentInvocationOutputSchema.shape.cost,
}).strict();

export function createStoryDeepReadPublishAction(store: Pick<StoryDeepReadStore, "publishStoryDeepReadRevision">): RegisteredAction {
    const definition: ActionDefinition = { ref: "artifact.publish@1", manifestHash: "builtin:artifact.publish@1", kind: "artifact",
        description: "Publish a Story deep read under its host execution fence.", capabilities: ["library:write"], executionPlacement: "host",
        inputSchema: storyDeepReadPublishInputSchema, outputSchema: storyDeepReadRevisionDetailSchema,
        execution: { idempotent: true, supportsCancellation: true, timeoutMs: null, retryPolicy: { maxAttempts: 1, backoffMs: 0 } } };
    return { definition, handler: async (raw: unknown, context: HostActionExecutionContext) => {
        if (context.signal.aborted) throw new ActionExecutionError("timeout", "Story deep read publication cancelled.", false);
        const parsed = storyDeepReadPublishInputSchema.safeParse(raw);
        if (!parsed.success) throw new ActionExecutionError("malformed_payload", "Story deep read data invalid", false);
        try {
            return await store.publishStoryDeepReadRevision({ ...parsed.data, workflowRunId: context.fence.workflowRunId, fence: context.fence });
        } catch (error) {
            const parsedCode = z.enum(["invalid_configuration", "dependency_unavailable", "malformed_payload"]).safeParse(
                error instanceof Error && "code" in error ? error.code : null);
            throw new ActionExecutionError(parsedCode.success ? parsedCode.data : "malformed_payload", "Story deep read publication failed.", false);
        }
    } };
}
