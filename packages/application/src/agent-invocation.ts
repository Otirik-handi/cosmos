import {
    agentInvocationInputSchema,
    agentInvocationOutputSchema,
    type AgentInvocationInput,
    type AgentInvocationOutput,
    type ActionDefinition,
} from "@cosmos/contracts";

import {
    ActionExecutionError,
    type ActionExecutionContext,
    type RegisteredAction,
} from "./action.js";

/** Runtime context shared by every Agent Invocation Adapter. */
export interface AgentInvocationContext {
    idempotencyKey: string;
    signal: AbortSignal;
}

/**
 * Provider-neutral boundary for one Agent call. Adapters must not own Cosmos
 * Job state, leases, terminal results, or domain persistence.
 */
export interface AgentInvocationPort {
    invoke(
        input: AgentInvocationInput,
        context: AgentInvocationContext,
    ): Promise<AgentInvocationOutput>;
}

export type FakeAgentInvocationResponse =
    | { kind: "success"; output: AgentInvocationOutput }
    | { kind: "error"; code: "dependency_unavailable" | "authentication_required" | "budget_exhausted" | "timeout"; message: string; retryable: boolean };

/** Deterministic adapter used to verify the Agent Action without a model. */
export class FakeAgentInvocationAdapter implements AgentInvocationPort {
    constructor(private readonly response: FakeAgentInvocationResponse) {}

    async invoke(
        input: AgentInvocationInput,
        context: AgentInvocationContext,
    ): Promise<AgentInvocationOutput> {
        if (context.signal.aborted) {
            throw {
                code: "cancelled",
                message: "Agent invocation was cancelled.",
                retryable: false,
            };
        }
        const parsedInput = agentInvocationInputSchema.parse(input);
        if (this.response.kind === "error") {
            throw new ActionExecutionError(
                this.response.code,
                this.response.message,
                this.response.retryable,
            );
        }
        return agentInvocationOutputSchema.parse({
            ...this.response.output,
            provider: this.response.output.provider || parsedInput.provider,
            model: this.response.output.model || parsedInput.model,
        });
    }
}

const agentInvocationDefinition: ActionDefinition = {
    ref: "agent.invoke@1",
    kind: "agent",
    description: "Invoke a configured Agent runtime.",
    capabilities: ["agent:invoke"],
    executionPlacement: "trusted_worker",
    inputSchema: agentInvocationInputSchema,
    outputSchema: agentInvocationOutputSchema,
    execution: {
        idempotent: false,
        supportsCancellation: true,
        timeoutMs: null,
        retryPolicy: {
            maxAttempts: 2,
            backoffMs: 1_000,
            retryableErrors: ["dependency_unavailable", "timeout", "rate_limited"],
        },
    },
};

/** Builds the executable Agent Action without creating a second runtime. */
export function createAgentInvocationAction(
    port: AgentInvocationPort,
): RegisteredAction {
    return {
        definition: agentInvocationDefinition,
        handler: async (input: unknown, context: ActionExecutionContext) => {
            const parsedInput = agentInvocationInputSchema.parse(input);
            const output = await port.invoke(parsedInput, context);
            return agentInvocationOutputSchema.parse(output);
        },
    };
}

export function getAgentInvocationDefinition(): ActionDefinition {
    return agentInvocationDefinition;
}
