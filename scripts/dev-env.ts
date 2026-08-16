import { resolve } from "node:path";

export function createWorkspaceDevEnvironment(
    rootDirectory: string,
    environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
    const configuredDataRoot = environment.COSMOS_DATA_ROOT?.trim();
    return {
        COSMOS_WORKFLOW_HOST_ENABLED:
            environment.COSMOS_WORKFLOW_HOST_ENABLED ?? "true",
        COSMOS_WORKSPACE_ROOT: rootDirectory,
        COSMOS_DATA_ROOT: resolve(
            rootDirectory,
            configuredDataRoot || ".cosmos",
        ),
    };
}
