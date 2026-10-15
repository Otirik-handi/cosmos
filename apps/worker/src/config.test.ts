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

    it("keeps Agent disabled until complete provider configuration is explicit", () => {
        expect(parseWorkerRuntimeConfig({}).agent).toBeNull();
        expect(() => parseWorkerRuntimeConfig({ COSMOS_AGENT_ENABLED: "true" })).toThrow(
            "COSMOS_AGENT_CONTEXT_WINDOW is required when COSMOS_AGENT_ENABLED=true.",
        );
        expect(parseWorkerRuntimeConfig({
            COSMOS_AGENT_ENABLED: "true",
            COSMOS_AGENT_PROVIDER: "jijiapi",
            COSMOS_AGENT_MODEL: "gpt-6-luna",
            COSMOS_AGENT_API: "openai-completions",
            COSMOS_AGENT_BASE_URL: "https://api-slb.jiji.cc/v1",
            COSMOS_AGENT_CONTEXT_WINDOW: "262144",
            COSMOS_AGENT_MAX_OUTPUT_TOKENS: "32768",
            COSMOS_AGENT_CONNECTION_ID: "connection-1",
        }).agent).toMatchObject({
            provider: "jijiapi",
            model: "gpt-6-luna",
            api: "openai-completions",
            baseUrl: "https://api-slb.jiji.cc/v1",
            contextWindow: 262144,
            maxOutputTokens: 32768,
            connectionId: "connection-1",
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
