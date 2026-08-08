import type { Instrumentation } from "next";

import type { Logger } from "@cosmos/logging";

let webLogger: Logger | null = null;

async function getWebLogger(): Promise<Logger | null> {
    if (process.env.NEXT_RUNTIME === "edge") {
        return null;
    }
    if (!webLogger) {
        const { createLogger } = await import("@cosmos/logging");
        webLogger = createLogger({
            service: "cosmos-web",
            fileName: "web",
        });
    }
    return webLogger;
}

export async function register(): Promise<void> {
    const logger = await getWebLogger();
    logger?.info("web.started", {
        runtime: process.env.NEXT_RUNTIME ?? "nodejs",
        mode: process.env.NODE_ENV ?? "development",
    });
}

export const onRequestError: Instrumentation.onRequestError = async (
    error,
    request,
    context,
) => {
    const logger = await getWebLogger();
    if (!logger) {
        return;
    }
    const digest = error
        && typeof error === "object"
        && "digest" in error
        ? String((error as { digest?: unknown }).digest)
        : undefined;
    logger.error("web.request.failed", {
        method: request.method,
        path: request.path.split("?")[0] || "/",
        routeType: context.routeType,
        routerKind: context.routerKind,
        digest,
    }, error);
};
