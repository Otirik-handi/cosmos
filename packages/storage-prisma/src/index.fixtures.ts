import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach } from "vitest";
import { type LoggerPort } from "@cosmos/application";
import type { SourceSnapshot } from "@cosmos/contracts";
import { PrismaCosmosRepository } from "./index.js";
import { resolvePrismaCliPath } from "./prisma-cli.js";














export const temporaryRoots: string[] = [];

export function captureLogger(): {
    logger: LoggerPort;
    records: Array<Record<string, unknown>>;
} {
    const records: Array<Record<string, unknown>> = [];
    const logger: LoggerPort = {
        child: () => logger,
        withContext: (_context, callback) => callback(),
        debug: (event, fields = {}) => {
            records.push({ ...fields, event, level: "debug" });
        },
        info: (event, fields = {}) => {
            records.push({ ...fields, event, level: "info" });
        },
        warn: (event, fields = {}) => {
            records.push({ ...fields, event, level: "warn" });
        },
        error: (event, fields = {}) => {
            records.push({ ...fields, event, level: "error" });
        },
    };
    return { logger, records };
}

afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
        recursive: true,
        force: true,
    })));
});

export function prepareDatabase(root: string): void {
    const schema = resolve(
        process.cwd(),
        "packages/storage-prisma/prisma/schema.prisma",
    );
    const prismaCli = resolvePrismaCliPath();
    const databaseUrl = `file:${resolve(root, "cosmos.sqlite").replaceAll("\\", "/")}`;
    writeFileSync(resolve(root, "cosmos.sqlite"), new Uint8Array());
    execFileSync(process.execPath, [
        prismaCli,
        "migrate",
        "deploy",
        "--schema",
        schema,
    ], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            DATABASE_URL: databaseUrl,
        },
        stdio: "ignore",
    });
}

export async function createFixtureSource(
    repository: PrismaCosmosRepository,
    input: { name: string; config: unknown; scheduleIntervalMs?: number },
): Promise<SourceSnapshot> {
    const created = await repository.createSource({
        name: input.name,
        sourceDefinitionRef: "source.fixture-rss@1",
        operationId: "fetch",
        config: input.config,
        ...(input.scheduleIntervalMs !== undefined ? { scheduleIntervalMs: input.scheduleIntervalMs } : {}),
    });
    // 启用状态归计划（ADR-0023 决策 2）：夹具也走计划端点，不再有来源激活路径。
    await repository.updateCollectionPlan(created.planId, {
        enabled: true,
        baseRevisionId: created.planRevisionId,
    });
    return repository.getSource(created.id) as Promise<SourceSnapshot>;
}
