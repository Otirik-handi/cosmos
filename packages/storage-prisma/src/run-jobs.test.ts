import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { PrismaCosmosRepository } from "./index.js";
import { createFixtureSource, prepareDatabase, temporaryRoots } from "./index.fixtures.js";

/**
 * OPS-002：产品面要能从 Run 走到 Job（状态、重试次数、错误）。Run 投影里没有 job 引用，
 * 所以由 `listRunJobs(runId)` 提供；`runId` 必须同时覆盖 legacy Run 与 durable WorkflowRun
 * 两种外键（两者共用同一个 Run 读端点）。
 */
it("lists the jobs of a run for both run flavours (OPS-002)", async () => {
    const root = await mkdtemp(join(tmpdir(), "cosmos-run-jobs-"));
    temporaryRoots.push(root);
    prepareDatabase(root);

    const repository = new PrismaCosmosRepository({ dataRoot: root });
    await repository.initialize();

    try {
        const source = await createFixtureSource(repository, { name: "Run jobs", config: {} });
        const run = await repository.prisma.run.create({
            data: {
                sourceInstanceId: source.id,
                triggerKind: "manual",
                status: "running",
            },
        });

        await repository.prisma.job.create({
            data: {
                kind: "source-ingest",
                status: "queued",
                idempotencyKey: "run-jobs:legacy",
                runId: run.id,
                attempts: 0,
                maxAttempts: 3,
            },
        });
        await repository.prisma.job.create({
            data: {
                kind: "source-ingest",
                status: "queued",
                idempotencyKey: "run-jobs:other-run",
                attempts: 0,
                maxAttempts: 3,
            },
        });

        const jobs = await repository.listRunJobs(run.id);
        expect(jobs).toHaveLength(1);
        expect(jobs[0]).toMatchObject({ runId: run.id, status: "queued", attempts: 0, maxAttempts: 3 });

        // 未知 Run 不报错，返回空列表（产品面据此显示"这个 Run 没有登记任务"）。
        expect(await repository.listRunJobs("run-does-not-exist")).toEqual([]);
    } finally {
        await repository.close();
    }
});
