import { describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => {
    const logger = {
        info: vi.fn(),
        error: vi.fn(),
    };
    return {
        logger,
        createLogger: vi.fn(() => logger),
    };
});

vi.mock("@cosmos/logging", () => ({
    createLogger: mocked.createLogger,
}));

import { onRequestError, register } from "./instrumentation.js";

describe("web instrumentation", () => {
    it("records safe server request error metadata without query content", async () => {
        await register();
        const error = Object.assign(
            new Error("token=secret"),
            { digest: "digest-1" },
        );

        await onRequestError(
            error as never,
            {
                method: "GET",
                path: "/dashboard?token=query-secret",
            } as never,
            {
                routeType: "render",
                routerKind: "App Router",
                routePath: "/dashboard",
                renderSource: "app-page",
            } as never,
        );

        expect(mocked.createLogger).toHaveBeenCalledWith({
            service: "cosmos-web",
            fileName: "web",
        });
        expect(mocked.logger.info).toHaveBeenCalledWith(
            "web.started",
            expect.objectContaining({
                runtime: expect.any(String),
            }),
        );
        expect(mocked.logger.error).toHaveBeenCalledWith(
            "web.request.failed",
            {
                method: "GET",
                path: "/dashboard",
                routeType: "render",
                routerKind: "App Router",
                digest: "digest-1",
            },
            error,
        );
        expect(JSON.stringify(mocked.logger.error.mock.calls))
            .not.toContain("token=query-secret");
    });
});
