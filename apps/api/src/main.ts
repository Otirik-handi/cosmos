import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppModule, cosmosRepository } from "./app.module.js";

async function bootstrap(): Promise<void> {
    await cosmosRepository.initialize();
    const app = await NestFactory.create(AppModule);

    app.enableCors({
        origin: process.env.COSMOS_ALLOWED_ORIGIN ?? true,
    });
    app.setGlobalPrefix("api/v1");

    const port = Number(process.env.COSMOS_API_PORT ?? "4310");
    const host = process.env.COSMOS_API_HOST ?? "0.0.0.0";

    await app.listen(port, host);
    console.log(JSON.stringify({
        event: "api.started",
        host,
        port,
        health: `http://localhost:${port}/api/v1/health`,
    }));

    const shutdown = async (signal: string): Promise<void> => {
        await app.close();
        await cosmosRepository.close();
        console.log(JSON.stringify({
            event: "api.stopped",
            signal,
        }));
    };
    process.once("SIGINT", () => void shutdown("SIGINT"));
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

void bootstrap();
