import { resolve } from "node:path";

export function createWorkspaceDevEnvironment(
    rootDirectory: string,
    environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
    const configuredDataRoot = environment.COSMOS_DATA_ROOT?.trim();

    // 运维者显式设置的服务端口/主机配置必须原样传给子进程；
    // 未设置时不注入，让各服务保持自身默认值。
    const serviceSettings = [
        "COSMOS_API_HOST",
        "COSMOS_API_PORT",
        "COSMOS_WEB_PORT",
        "COSMOS_WORKER_ADMIN_HOST",
        "COSMOS_WORKER_ADMIN_PORT",
    ] as const;

    const serviceEnvironment = Object.fromEntries(
        serviceSettings
            .map((key) => [key, environment[key]?.trim()])
            .filter(([, value]) => value !== undefined && value !== ""),
    );

    return {
        ...serviceEnvironment,
        COSMOS_WORKFLOW_HOST_ENABLED:
            environment.COSMOS_WORKFLOW_HOST_ENABLED ?? "true",
        COSMOS_WORKSPACE_ROOT: rootDirectory,
        COSMOS_DATA_ROOT: resolve(
            rootDirectory,
            configuredDataRoot || ".cosmos",
        ),
    };
}
