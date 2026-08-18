import { describe, expect, it } from "vitest";

import { parseWorkerRuntimeConfig } from "./config.js";

describe("parseWorkerRuntimeConfig", () => {
    it("uses stable defaults and preserves exact false feature switches", () => {
        const config = parseWorkerRuntimeConfig({
            COSMOS_WORKFLOW_HOST_ENABLED: "false",
            COSMOS_WORKER_ADMIN_ENABLED: "false",
        });

        expect(config).toMatchObject({
            pollMs: 30_000,
            leaseMs: 120_000,
            shutdownDeadlineMs: 30_000,
            version: "0.1.0",
            workflowHostEnabled: false,
            workerAdminEnabled: false,
            workerAdminHost: "127.0.0.1",
            workerAdminPort: 9091,
            workerAdminToken: null,
        });
    });

    it.each([
        ["COSMOS_WORKER_POLL_MS", "0", "COSMOS_WORKER_POLL_MS must be a positive integer."],
        ["COSMOS_WORKER_POLL_MS", "1.5", "COSMOS_WORKER_POLL_MS must be a positive integer."],
        ["COSMOS_WORKER_POLL_MS", "NaN", "COSMOS_WORKER_POLL_MS must be a positive integer."],
        ["COSMOS_WORKER_LEASE_MS", "0", "COSMOS_WORKER_LEASE_MS must be a positive integer."],
        ["COSMOS_WORKER_LEASE_MS", "Infinity", "COSMOS_WORKER_LEASE_MS must be a positive integer."],
        [
            "COSMOS_WORKER_SHUTDOWN_DEADLINE_MS",
            "-1",
            "COSMOS_WORKER_SHUTDOWN_DEADLINE_MS must be an integer between 0 and 86400000.",
        ],
        [
            "COSMOS_WORKER_SHUTDOWN_DEADLINE_MS",
            "86400001",
            "COSMOS_WORKER_SHUTDOWN_DEADLINE_MS must be an integer between 0 and 86400000.",
        ],
    ])("rejects invalid %s=%s before runtime construction", (name, value, message) => {
        expect(() => parseWorkerRuntimeConfig({ [name]: value })).toThrow(message);
    });

    it("accepts safe integer operational settings and normalizes identity values", () => {
        expect(parseWorkerRuntimeConfig({
            COSMOS_WORKER_POLL_MS: "200",
            COSMOS_WORKER_LEASE_MS: "500",
            COSMOS_WORKER_SHUTDOWN_DEADLINE_MS: "0",
            COSMOS_WORKER_ID: " worker-a ",
            COSMOS_VERSION: " 2.0.0 ",
            COSMOS_WORKER_ADMIN_HOST: " 0.0.0.0 ",
            COSMOS_WORKER_ADMIN_PORT: "0",
            COSMOS_WORKER_ADMIN_TOKEN: " token ",
        })).toMatchObject({
            pollMs: 200,
            leaseMs: 500,
            shutdownDeadlineMs: 0,
            workerId: "worker-a",
            version: "2.0.0",
            workerAdminHost: "0.0.0.0",
            workerAdminPort: 0,
            workerAdminToken: "token",
        });
    });
});
