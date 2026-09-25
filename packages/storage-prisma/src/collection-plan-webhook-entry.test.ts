import { describe, expect, it } from "vitest";

import { PrismaCosmosRepository } from "./index.js";
import { withRepository } from "./index.fixtures.js";

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
        await withRepository("webhook-entry", async (repository) => {
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
        });
    });

    it("轮换入口：标识与凭证一起换新，旧凭证字节被删除", async () => {
        await withRepository("webhook-entry", async (repository) => {
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
        });
    });

    it("撤销入口是幂等的：删掉入口标识与凭证字节，调度行保持不动", async () => {
        await withRepository("webhook-entry", async (repository) => {
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
        });
    });

    it("计划不存在时两个入口命令都报 not_found", async () => {
        await withRepository("webhook-entry", async (repository) => {
            await expect(repository.rotateCollectionPlanWebhookEntry("plan:missing"))
                .rejects.toMatchObject({ code: "not_found" });
            await expect(repository.revokeCollectionPlanWebhookEntry("plan:missing"))
                .rejects.toMatchObject({ code: "not_found" });
        });
    });

    it("入口解析与凭证校验：只回答能不能触发，且轮换/停用后旧入口立刻失效", async () => {
        await withRepository("webhook-entry", async (repository) => {
            const source = await createPlanWithSchedule(repository);
            const entry = await repository.rotateCollectionPlanWebhookEntry(source.planId);
            const tokenOf = (entryPath: string) => entryPath.split("/").pop() ?? "";
            const token = tokenOf(entry.entryPath);

            const target = await repository.resolveCollectionPlanWebhookEntry(token);
            expect(target).toMatchObject({
                planId: source.planId,
                sourceId: source.id,
                planEnabled: false,
                bindingEnabled: true,
            });
            expect(target?.secretRef).not.toBeNull();
            // 校验只回答对与不对；明文不出仓储。
            await expect(repository.verifyCollectionPlanWebhookCredential(target?.secretRef ?? "", entry.credential))
                .resolves.toBe(true);
            await expect(repository.verifyCollectionPlanWebhookCredential(target?.secretRef ?? "", "wrong"))
                .resolves.toBe(false);
            await expect(repository.resolveCollectionPlanWebhookEntry("no-such-entry")).resolves.toBeNull();

            // 轮换后旧标识解析不到，新标识可以。
            const rotated = await repository.rotateCollectionPlanWebhookEntry(source.planId);
            await expect(repository.resolveCollectionPlanWebhookEntry(token)).resolves.toBeNull();
            await expect(repository.resolveCollectionPlanWebhookEntry(tokenOf(rotated.entryPath)))
                .resolves.toMatchObject({ planEnabled: false });

            // 计划启用后 planEnabled 跟着走：入口校验依赖它来拒绝停用计划。
            await repository.prisma.collectionPlan.update({
                where: { id: source.planId },
                data: { enabled: true },
            });
            await expect(repository.resolveCollectionPlanWebhookEntry(tokenOf(rotated.entryPath)))
                .resolves.toMatchObject({ planEnabled: true });

            // 撤销后入口解析不到。
            await repository.revokeCollectionPlanWebhookEntry(source.planId);
            await expect(repository.resolveCollectionPlanWebhookEntry(tokenOf(rotated.entryPath))).resolves.toBeNull();
        });
    });
});
