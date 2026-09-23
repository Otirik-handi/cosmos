import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { PrismaCosmosRepository } from "./index.js";
import { resolvePrismaCliPath } from "./prisma-cli.js";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function prepareDatabase(root: string): void {
    const schema = resolve(process.cwd(), "packages/storage-prisma/prisma/schema.prisma");
    const prismaCli = resolvePrismaCliPath();
    const databaseUrl = `file:${resolve(root, "cosmos.sqlite").replaceAll("\\", "/")}`;
    writeFileSync(resolve(root, "cosmos.sqlite"), new Uint8Array());
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy", "--schema", schema], {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: "ignore",
    });
}

async function createRepository(): Promise<PrismaCosmosRepository> {
    const root = await mkdtemp(join(tmpdir(), "cosmos-webhook-entry-"));
    roots.push(root);
    prepareDatabase(root);
    const repository = new PrismaCosmosRepository({ dataRoot: root });
    await repository.initialize();
    return repository;
}

async function createPlanWithSchedule(repository: PrismaCosmosRepository) {
    return repository.createSource({
        name: "动态",
        sourceDefinitionRef: "source.rss@1",
        operationId: "fetch",
        config: { feedUrl: "https://example.test/feed.xml" },
        scheduleIntervalMs: 1_800_000,
    });
}

describe("CollectionPlan webhook 入口 (ADR-0024)", () => {
    it("生成入口：标识进路径、凭证进 SecretStore，读投影只回答「已配置」", async () => {
        const repository = await createRepository();
        try {
            const source = await createPlanWithSchedule(repository);
            const entry = await repository.rotateCollectionPlanWebhookEntry(source.planId);

            // 入口标识是不可猜的随机值，凭证是另一份更强的随机值：两者都不该是实体 id。
            expect(entry.entryPath).toMatch(/^\/hooks\/collection-plans\/[A-Za-z0-9_-]{30,}$/);
            expect(entry.credential).toMatch(/^[A-Za-z0-9_-]{40,}$/);
            expect(entry.entryPath).not.toContain(source.planId);

            const plan = await repository.getCollectionPlan(source.planId);
            expect(plan?.webhook).toEqual({ entryPath: entry.entryPath, credentialConfigured: true });
            // 明文凭证不在这条读路径上，任何投影都不该把它带出来。
            expect(JSON.stringify(plan)).not.toContain(entry.credential);

            // 凭证确实落进了 SecretStore：入口校验要用它，而不是行上的一串明文。
            const binding = await repository.prisma.triggerBinding.findFirstOrThrow({
                where: { planId: source.planId, kind: "webhook" },
            });
            expect(binding.secretRef).not.toBeNull();
            await expect(repository.secrets.read(binding.secretRef ?? "")).resolves.toBe(entry.credential);
            // 调度行不受影响：生成入口不等于换掉定时触发（ADR-0025）。
            expect(plan?.scheduleIntervalMs).toBe(1_800_000);
        } finally {
            await repository.close();
        }
    });

    it("轮换入口：标识与凭证一起换新，旧凭证字节被删除", async () => {
        const repository = await createRepository();
        try {
            const source = await createPlanWithSchedule(repository);
            const first = await repository.rotateCollectionPlanWebhookEntry(source.planId);
            const firstBinding = await repository.prisma.triggerBinding.findFirstOrThrow({
                where: { planId: source.planId, kind: "webhook" },
            });
            const firstRef = firstBinding.secretRef ?? "";

            const second = await repository.rotateCollectionPlanWebhookEntry(source.planId);

            expect(second.entryPath).not.toBe(first.entryPath);
            expect(second.credential).not.toBe(first.credential);
            // 旧凭证立刻失效：字节已经不在，入口不可能再拿它通过校验。
            await expect(repository.secrets.read(firstRef)).resolves.toBeNull();

            const secondBinding = await repository.prisma.triggerBinding.findFirstOrThrow({
                where: { planId: source.planId, kind: "webhook" },
            });
            expect(secondBinding.id).toBe(firstBinding.id);
            expect(secondBinding.revision).toBe(2);
            await expect(repository.secrets.read(secondBinding.secretRef ?? "")).resolves.toBe(second.credential);
            await expect(repository.getCollectionPlan(source.planId))
                .resolves.toMatchObject({ webhook: { entryPath: second.entryPath } });
        } finally {
            await repository.close();
        }
    });

    it("撤销入口是幂等的：删掉入口标识与凭证字节，调度行保持不动", async () => {
        const repository = await createRepository();
        try {
            const source = await createPlanWithSchedule(repository);
            await repository.rotateCollectionPlanWebhookEntry(source.planId);
            const binding = await repository.prisma.triggerBinding.findFirstOrThrow({
                where: { planId: source.planId, kind: "webhook" },
            });
            const secretRef = binding.secretRef ?? "";

            const revoked = await repository.revokeCollectionPlanWebhookEntry(source.planId);
            expect(revoked.webhook).toBeNull();
            expect(revoked.scheduleIntervalMs).toBe(1_800_000);
            await expect(repository.secrets.read(secretRef)).resolves.toBeNull();
            await expect(repository.prisma.triggerBinding.count({ where: { planId: source.planId, kind: "webhook" } }))
                .resolves.toBe(0);

            // 再撤一次不报错，也不动调度行。
            await expect(repository.revokeCollectionPlanWebhookEntry(source.planId))
                .resolves.toMatchObject({ webhook: null, scheduleIntervalMs: 1_800_000 });
        } finally {
            await repository.close();
        }
    });

    it("计划不存在时两个入口命令都报 not_found", async () => {
        const repository = await createRepository();
        try {
            await expect(repository.rotateCollectionPlanWebhookEntry("plan:missing"))
                .rejects.toMatchObject({ code: "not_found" });
            await expect(repository.revokeCollectionPlanWebhookEntry("plan:missing"))
                .rejects.toMatchObject({ code: "not_found" });
        } finally {
            await repository.close();
        }
    });
});
