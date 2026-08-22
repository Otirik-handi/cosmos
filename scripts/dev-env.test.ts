import { describe, expect, it } from "vitest";

import { createWorkspaceDevEnvironment } from "./dev-env.js";

describe("development workspace environment", () => {
    it("passes operator service settings through to child processes", () => {
        const environment = createWorkspaceDevEnvironment("/repo", {
            COSMOS_API_HOST: "0.0.0.0",
            COSMOS_API_PORT: "4312",
            COSMOS_WEB_PORT: "3307",
            COSMOS_WORKER_ADMIN_HOST: "127.0.0.1",
            COSMOS_WORKER_ADMIN_PORT: "9093",
        });

        expect(environment).toMatchObject({
            COSMOS_API_HOST: "0.0.0.0",
            COSMOS_API_PORT: "4312",
            COSMOS_WEB_PORT: "3307",
            COSMOS_WORKER_ADMIN_HOST: "127.0.0.1",
            COSMOS_WORKER_ADMIN_PORT: "9093",
            COSMOS_WORKFLOW_HOST_ENABLED: "true",
        });
    });

    it("omits unset or blank service settings instead of injecting defaults", () => {
        const environment = createWorkspaceDevEnvironment("/repo", {
            COSMOS_WEB_PORT: "   ",
        });

        expect(environment.COSMOS_WEB_PORT).toBeUndefined();
        expect(environment.COSMOS_API_PORT).toBeUndefined();
        expect(environment.COSMOS_WORKER_ADMIN_PORT).toBeUndefined();
        expect(environment.COSMOS_DATA_ROOT).toContain(".cosmos");
    });
});
