import { once } from "node:events";
import { createServer } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import {
    findAvailablePort,
    withApiPortEnvironment,
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
});
