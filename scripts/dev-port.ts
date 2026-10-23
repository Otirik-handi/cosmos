import { createServer } from "node:net";

export async function findAvailablePort(
    preferredPort: number,
    host = "127.0.0.1",
    maxAttempts = 50,
    label = "API",
    excludedPorts: ReadonlySet<number> = new Set(),
): Promise<number> {
    if (
        !Number.isInteger(preferredPort)
        || preferredPort < 1
        || preferredPort > 65_535
    ) {
        throw new Error(`Invalid ${label} port: ${preferredPort}`);
    }
    for (let offset = 0; offset < maxAttempts; offset += 1) {
        const candidate = preferredPort + offset;
        if (candidate > 65_535) {
            break;
        }
        if (excludedPorts.has(candidate)) {
            continue;
        }
        if (await isPortAvailable(candidate, host)) {
            return candidate;
        }
    }

    throw new Error(
        `No available ${label} port found from ${preferredPort} to `
        + `${Math.min(preferredPort + maxAttempts - 1, 65_535)}.`,
    );
}

export function withApiPortEnvironment(
    environment: NodeJS.ProcessEnv,
    port: number,
): NodeJS.ProcessEnv {
    const apiUrl = `http://localhost:${port}`;
    return {
        ...environment,
        COSMOS_API_PORT: String(port),
        COSMOS_API_URL: apiUrl,
        NEXT_PUBLIC_COSMOS_API_URL: apiUrl,
    };
}

export function withModelConfigurationAuthoritiesEnvironment(
    environment: NodeJS.ProcessEnv,
    apiPort: number,
): NodeJS.ProcessEnv {
    return {
        ...environment,
        COSMOS_MODEL_CONFIGURATION_AUTHORITIES: `localhost:${apiPort},127.0.0.1:${apiPort}`,
    };
}

export function withWebOriginEnvironment(
    environment: NodeJS.ProcessEnv,
    webPort: number,
): NodeJS.ProcessEnv {
    // dev 编排拥有端口选择权：覆盖 .env / 全局环境里钉在默认端口的静态来源，
    // 避免端口漂移后浏览器被 CORS 拦截。
    return {
        ...environment,
        COSMOS_ALLOWED_ORIGIN: `http://localhost:${webPort}`,
    };
}

/**
 * 单独启动 API（`bun run dev:api`）时也要有完整的写信任集合：缺任一项都会让所有
 * 模型配置写请求变成 403，而读取仍然正常，看上去像网络故障。Web 端口没有编排可
 * 依靠，只能取自 `COSMOS_WEB_PORT` 或默认 3000；浏览器换了端口就要重设该变量。
 */
export function withApiTrustEnvironment(
    environment: NodeJS.ProcessEnv,
    apiPort: number,
    webPort: number,
): NodeJS.ProcessEnv {
    return withModelConfigurationAuthoritiesEnvironment(
        withWebOriginEnvironment(environment, webPort),
        apiPort,
    );
}

async function isPortAvailable(port: number, host: string): Promise<boolean> {
    return new Promise((resolve) => {
        const server = createServer();
        let settled = false;

        const finish = (available: boolean): void => {
            if (settled) {
                return;
            }
            settled = true;
            resolve(available);
        };

        server.once("error", () => {
            finish(false);
        });
        server.listen(port, host, () => {
            server.close((error) => {
                finish(!error);
            });
        });
    });
}
