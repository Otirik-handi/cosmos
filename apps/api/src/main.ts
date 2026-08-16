import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import {
    AppModule,
    cosmosLogger,
    cosmosRepository,
} from "./app.module.js";
import {
    RequestExceptionFilter,
    requestContextMiddleware,
    RequestLoggingInterceptor,
} from "./request-logging.js";

interface ProbeResponse {
    status(code: number): ProbeResponse;
    json(body: unknown): void;
}

type ProbeHttpAdapter = {
    get(path: string, handler: (request: unknown, response: ProbeResponse) => void): void;
};

async function bootstrap(): Promise<void> {
    const startedAt = Date.now();
    let app: Awaited<ReturnType<typeof NestFactory.create>> | null = null;
    let apiReady = false;
    let shuttingDown = false;
    try {
        cosmosLogger.info("api.bootstrap.started");
        await cosmosRepository.initialize();
        app = await NestFactory.create(AppModule);

        app.use(requestContextMiddleware(cosmosLogger));
        app.enableCors({
            origin: process.env.COSMOS_ALLOWED_ORIGIN ?? true,
        });
        app.setGlobalPrefix("api/v1");
        app.useGlobalInterceptors(new RequestLoggingInterceptor(cosmosLogger));
        app.useGlobalFilters(new RequestExceptionFilter(cosmosLogger));

        const probeHttp = app.getHttpAdapter().getInstance() as ProbeHttpAdapter;
        probeHttp.get("/healthz", (_request, response) => {
            response.status(200).json({
                status: "ok",
                service: "cosmos-api",
                timestamp: new Date().toISOString(),
            });
        });
        probeHttp.get("/readyz", (_request, response) => {
            response.status(apiReady ? 200 : 503).json({
                status: apiReady ? "ready" : "starting",
                service: "cosmos-api",
                timestamp: new Date().toISOString(),
            });
        });

        const port = Number(process.env.COSMOS_API_PORT ?? "4310");
        const host = process.env.COSMOS_API_HOST ?? "127.0.0.1";

        await app.listen(port, host);
        apiReady = true;
        cosmosLogger.info("api.started", {
            host,
            port,
            health: `http://localhost:${port}/api/v1/health`,
            durationMs: Date.now() - startedAt,
        });

        const shutdown = async (signal: string): Promise<void> => {
            if (shuttingDown) {
                return;
            }
            shuttingDown = true;
            apiReady = false;
            let shutdownFailed = false;
            try {
                await app?.close();
            } catch (error) {
                shutdownFailed = true;
                cosmosLogger.error("api.stop_failed", {
                    signal,
                    stage: "app.close",
                }, error);
            }
            try {
                await cosmosRepository.close();
            } catch (error) {
                shutdownFailed = true;
                cosmosLogger.error("api.stop_failed", {
                    signal,
                    stage: "repository.close",
                }, error);
            }
            cosmosLogger.info("api.stopped", {
                signal,
                status: shutdownFailed ? "degraded" : "ok",
            });
            await cosmosLogger.close().catch(() => {
                shutdownFailed = true;
            });
            if (shutdownFailed) {
                process.exitCode = 1;
            }
        };
        process.once("SIGINT", () => void shutdown("SIGINT"));
        process.once("SIGTERM", () => void shutdown("SIGTERM"));
    } catch (error) {
        cosmosLogger.error("api.failed", {
            durationMs: Date.now() - startedAt,
        }, error);
        try {
            await app?.close();
        } catch (cleanupError) {
            cosmosLogger.error("api.stop_failed", {
                stage: "bootstrap.app.close",
            }, cleanupError);
        }
        try {
            await cosmosRepository.close();
        } catch (cleanupError) {
            cosmosLogger.error("api.stop_failed", {
                stage: "bootstrap.repository.close",
            }, cleanupError);
        }
        await cosmosLogger.close();
        process.exitCode = 1;
    }
}

void bootstrap();
