import {
    ActionExecutionError,
    createAgentInvocationAction,
    type AgentInvocationContext,
    type RegisteredAction,
    type SecretStorePort,
} from "@cosmos/application";
import {
    createPiAiOpenAICompletionsModel,
    PiAiAgentInvocationAdapter,
    type PiAiClient,
    type PiAiCredentialResolver,
} from "@cosmos/agent-pi-ai";
import type { ConnectionInstance } from "@cosmos/contracts";
import type { WorkerAgentConfig } from "./config.js";

export interface WorkerAgentConnectionRepository {
    getConnection(connectionId: string): Promise<ConnectionInstance | null>;
}

export function createWorkerAgentAction(
    agentConfig: WorkerAgentConfig,
    dependencies: {
        connections: WorkerAgentConnectionRepository;
        secrets: SecretStorePort;
        client?: PiAiClient;
    },
): RegisteredAction {
    const credentials: PiAiCredentialResolver = {
        withCredential: async <T>(
            provider: string,
            context: AgentInvocationContext,
            use: (credential: string) => Promise<T>,
        ): Promise<T> => {
            if (context.signal.aborted) {
                throw new ActionExecutionError("cancelled", "Agent invocation was cancelled.", false);
            }
            const connection = await dependencies.connections.getConnection(agentConfig.connectionId);
            if (context.signal.aborted) {
                throw new ActionExecutionError("cancelled", "Agent invocation was cancelled.", false);
            }
            if (
                !connection ||
                connection.id !== agentConfig.connectionId ||
                connection.status !== "active" ||
                !connection.secretRef
            ) {
                throw new ActionExecutionError(
                    "authentication_required",
                    "The configured Agent connection is missing, inactive, or has no credential.",
                    false,
                );
            }
            if (provider !== agentConfig.provider) {
                throw new ActionExecutionError(
                    "authentication_required",
                    "The configured Agent connection does not match this provider invocation.",
                    false,
                );
            }
            let credential: string | null;
            try {
                credential = await dependencies.secrets.read(connection.secretRef);
            } catch {
                if (context.signal.aborted) {
                    throw new ActionExecutionError("cancelled", "Agent invocation was cancelled.", false);
                }
                throw new ActionExecutionError(
                    "authentication_required",
                    "The configured Agent connection credential could not be loaded.",
                    false,
                );
            }
            if (context.signal.aborted) {
                throw new ActionExecutionError("cancelled", "Agent invocation was cancelled.", false);
            }
            if (credential === null || credential.trim().length === 0) {
                throw new ActionExecutionError(
                    "authentication_required",
                    "The configured Agent connection has no stored credential.",
                    false,
                );
            }
            try {
                return await use(credential);
            } finally {
                credential = null;
            }
        },
    };
    const model = createPiAiOpenAICompletionsModel({
        provider: agentConfig.provider,
        model: agentConfig.model,
        name: agentConfig.model,
        baseUrl: agentConfig.baseUrl,
        contextWindow: agentConfig.contextWindow,
        maxTokens: agentConfig.maxOutputTokens,
    });
    return createAgentInvocationAction(new PiAiAgentInvocationAdapter({
        credentials,
        model,
        client: dependencies.client,
    }));
}
