import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
    createMediaAcquirer,
    mediaDownloadCapability,
    type IngestConnector,
} from "../../../packages/application/src/index.js";
import type { NormalizedIngestItem } from "../../../packages/domain/src/index.js";

import {
    createIngestActions,
    createIngestWorkflowDefinition,
} from "../../../packages/application/src/workflow-ingest.js";
import { IngestWorkflowControlService } from "../../../packages/application/src/workflow-control.js";
import { PrismaCosmosRepository } from "@cosmos/storage-prisma";
import { resolvePrismaCliPath } from "../../../packages/storage-prisma/src/prisma-cli.js";

import { createWorkflowHost } from "./workflow-host.js";

export const temporaryRoots: string[] = [];

/**
 * 每个测试文件各自注册 `afterEach(cleanupTemporaryRoots)`——装置模块不注册钩子，
 * 否则被导入时会重复注册清理。
 */
export async function cleanupTemporaryRoots(): Promise<void> {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
        recursive: true,
        force: true,
    })));
}


export async function drainWorkflow(
    composition: ReturnType<typeof createWorkflowHost>,
    runId: string,
) {
    for (let index = 0; index < 60; index += 1) {
        await composition.runLane.pollOnce();
        await composition.activityWorker.pollOnce();
        await composition.completionDispatcher.pollOnce();
        const current = await composition.store.loadWorkflowEnvelope(runId);
        if (!current) continue;
        if (current.status === "completed" || current.status === "failed" || current.status === "cancelled") {
            return current;
        }
    }
    throw new Error(`Workflow ${runId} did not reach a terminal state.`);
}

export function prepareDatabase(root: string): void {
    const schema = resolve(process.cwd(), "packages/storage-prisma/prisma/schema.prisma");
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
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: "ignore",
    });
}

export async function createFixtureSource(
    repository: PrismaCosmosRepository,
    name: string,
) {
    const created = await repository.createSource({
        name,
        sourceDefinitionRef: "source.fixture-rss@1",
        operationId: "fetch",
        config: {},
    });
    await repository.updateCollectionPlan(created.planId, {
        enabled: true,
        baseRevisionId: created.planRevisionId,
    });
    const source = await repository.getSource(created.id);
    if (!source) throw new Error(`Fixture source missing: ${created.id}`);
    return source;
}
