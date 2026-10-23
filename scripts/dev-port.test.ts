import { once } from "node:events";
import { createServer } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import {
    findAvailablePort,
    withApiPortEnvironment,
    withApiTrustEnvironment,
    withModelConfigurationAuthoritiesEnvironment,
    withWebOriginEnvironment,
} from "./dev-port.js";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
    await Promise.all(servers.splice(0).map(async (server) => {
        if (server.listening) {
            server.close();
            await once(server, "close");
        }
    }));
});

describe("development API port selection", () => {
    it("moves to an available port when the preferred port is occupied", async () => {
        const server = createServer();
        servers.push(server);
        server.listen(0, "127.0.0.1");
        await once(server, "listening");

        const address = server.address();
        if (!address || typeof address === "string") {
            throw new Error("Test server did not expose a TCP address.");
        }

        const selectedPort = await findAvailablePort(
            address.port,
            "127.0.0.1",
        );

        expect(selectedPort).toBeGreaterThan(address.port);
    });

    it("skips ports listed in the exclusion set", async () => {
        const server = createServer();
        servers.push(server);
        server.listen(0, "127.0.0.1");
        await once(server, "listening");

        const address = server.address();
        if (!address || typeof address === "string") {
            throw new Error("Test server did not expose a TCP address.");
        }

        // 占用 preferred，并把顺延的第一候选加入排除集，应继续向后找。
        const excluded = new Set([address.port + 1]);
        const selectedPort = await findAvailablePort(
            address.port,
            "127.0.0.1",
            50,
            "COSMOS_WEB_PORT",
            excluded,
        );

        expect(selectedPort).toBeGreaterThan(address.port + 1);
    });

    it("rejects invalid ports with the requesting label", async () => {
        await expect(
            findAvailablePort(0, "127.0.0.1", 50, "COSMOS_WEB_PORT"),
        ).rejects.toThrow(/Invalid COSMOS_WEB_PORT port/u);
    });

    it("propagates the selected API URL to Web development settings", () => {
        const environment = withApiPortEnvironment(
            { COSMOS_API_PORT: "4310" },
            4311,
        );

        expect(environment).toMatchObject({
            COSMOS_API_PORT: "4311",
            COSMOS_API_URL: "http://localhost:4311",
            NEXT_PUBLIC_COSMOS_API_URL: "http://localhost:4311",
        });
    });
    it("allows only exact loopback API authorities on the selected port", () => {
        expect(withModelConfigurationAuthoritiesEnvironment({
            COSMOS_MODEL_CONFIGURATION_AUTHORITIES: "stale.example:4310",
        }, 4311)).toMatchObject({
            COSMOS_MODEL_CONFIGURATION_AUTHORITIES: "localhost:4311,127.0.0.1:4311",
        });
    });

    it("derives the allowed origin from the selected web port after fallback", () => {
        // 模拟 .env / 全局环境把来源钉在默认 Web 端口，随后两个服务都发生端口回退。
        const environment = withWebOriginEnvironment(
            withApiPortEnvironment(
                { COSMOS_ALLOWED_ORIGIN: "http://localhost:3000" },
                4311,
            ),
            3001,
        );

        expect(environment).toMatchObject({
            COSMOS_API_URL: "http://localhost:4311",
            NEXT_PUBLIC_COSMOS_API_URL: "http://localhost:4311",
            COSMOS_ALLOWED_ORIGIN: "http://localhost:3001",
        });
    });

    it("gives a standalone API both halves of the write trust", () => {
        // 单独启动 API 也必须同时有来源与 authority：缺任一项都会让保存变成 403。
        expect(withApiTrustEnvironment({}, 14311, 3002)).toMatchObject({
            COSMOS_ALLOWED_ORIGIN: "http://localhost:3002",
            COSMOS_MODEL_CONFIGURATION_AUTHORITIES: "localhost:14311,127.0.0.1:14311",
        });
    });

    it("overrides a stale origin pinned in .env when the ports drift", () => {
        const environment = withApiTrustEnvironment(
            {
                COSMOS_ALLOWED_ORIGIN: "http://localhost:3000",
                COSMOS_MODEL_CONFIGURATION_AUTHORITIES: "localhost:4310,127.0.0.1:4310",
            },
            14311,
            3002,
        );

        expect(environment).toMatchObject({
            COSMOS_ALLOWED_ORIGIN: "http://localhost:3002",
            COSMOS_MODEL_CONFIGURATION_AUTHORITIES: "localhost:14311,127.0.0.1:14311",
        });
    });
});
