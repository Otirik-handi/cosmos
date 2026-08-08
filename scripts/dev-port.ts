import { createServer } from "node:net";

export async function findAvailablePort(
    preferredPort: number,
    host = "127.0.0.1",
    maxAttempts = 50,
): Promise<number> {
    if (
        !Number.isInteger(preferredPort)
        || preferredPort < 1
        || preferredPort > 65_535
    ) {
        throw new Error(`Invalid COSMOS_API_PORT: ${preferredPort}`);
    }

    for (let offset = 0; offset < maxAttempts; offset += 1) {
        const candidate = preferredPort + offset;
        if (candidate > 65_535) {
            break;
        }
        if (await isPortAvailable(candidate, host)) {
            return candidate;
        }
    }

    throw new Error(
        `No available API port found from ${preferredPort} to `
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
