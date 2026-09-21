import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { PrismaCosmosRepository } from "./index.js";
import { prepareDatabase, temporaryRoots } from "./index.fixtures.js";

/**
 * 启用状态归采集计划（ADR-0023 决策 2）：写入口是 `updateCollectionPlan` 的 `enabled`，
 * CAS 用计划自身的 revision。这些用例替代原先的 `source-activation.test.ts`——那条路径
 * （`POST /sources/{id}/activation-commands` 与 `SourceActivationCommand` 幂等表）已随
 * 归属切换删除，不再是第二个所有者。
 */
it("enables and disables the plan through its own revision CAS", async () => {
    const root = await mkdtemp(join(tmpdir(), "cosmos-plan-activation-test-"));
    temporaryRoots.push(root);
    prepareDatabase(root);

    const repository = new PrismaCosmosRepository({ dataRoot: root });
    await repository.initialize();

    try {
        const created = await repository.createSource({
            name: "Plan activation fixture",
            sourceDefinitionRef: "source.fixture-rss@1",
            operationId: "fetch",
            config: {},
        });
        expect(created).toMatchObject({
            enabled: false,
            planRevisionId: `${created.planId}:1`,
        });

        const enabled = await repository.updateCollectionPlan(created.planId, {
            enabled: true,
            baseRevisionId: created.planRevisionId,
        });
        expect(enabled).toMatchObject({
            enabled: true,
            revisionId: `${created.planId}:2`,
        });

        // 来源读投影跟随计划：启用状态只有一个所有者，两个投影不能各说一套。
        await expect(repository.getSource(created.id)).resolves.toMatchObject({
            enabled: true,
            planRevisionId: `${created.planId}:2`,
        });

        // 过期 baseRevisionId 必须冲突，而不是把停用写进一个已经被改过的计划。
        await expect(repository.updateCollectionPlan(created.planId, {
            enabled: false,
            baseRevisionId: created.planRevisionId,
        })).rejects.toMatchObject({ code: "conflict" });

        const disabled = await repository.updateCollectionPlan(created.planId, {
            enabled: false,
            baseRevisionId: enabled.revisionId,
        });
        expect(disabled).toMatchObject({
            enabled: false,
            revisionId: `${created.planId}:3`,
        });
    } finally {
        await repository.close();
    }
});

it("keeps a stale plan revision from passing as a source revision", async () => {
    const root = await mkdtemp(join(tmpdir(), "cosmos-plan-activation-domain-test-"));
    temporaryRoots.push(root);
    prepareDatabase(root);

    const repository = new PrismaCosmosRepository({ dataRoot: root });
    await repository.initialize();

    try {
        const created = await repository.createSource({
            name: "Plan CAS domain fixture",
            sourceDefinitionRef: "source.fixture-rss@1",
            operationId: "fetch",
            config: {},
        });
        // 来源的 revisionId 与计划的 revisionId 是独立 CAS 域：拿来源的 revision 去改计划
        // 必须被拒绝，否则两个域会互相顶替（ADR-0023 决策 2）。
        await expect(repository.updateCollectionPlan(created.planId, {
            enabled: true,
            baseRevisionId: created.revisionId,
        })).rejects.toMatchObject({ code: "conflict" });

        await expect(repository.updateCollectionPlan(created.planId, {
            enabled: true,
            baseRevisionId: "plan:someone-else:1",
        })).rejects.toMatchObject({ code: "conflict" });
    } finally {
        await repository.close();
    }
});

it("schedules by plan enabled state, not by the source row", async () => {
    const root = await mkdtemp(join(tmpdir(), "cosmos-plan-schedule-gate-test-"));
    temporaryRoots.push(root);
    prepareDatabase(root);

    const repository = new PrismaCosmosRepository({ dataRoot: root });
    await repository.initialize();

    try {
        const created = await repository.createSource({
            name: "Schedule gate fixture",
            sourceDefinitionRef: "source.fixture-rss@1",
            operationId: "fetch",
            config: {},
            scheduleIntervalMs: 60_000,
        });

        // 建来源时计划是停用的，即使调度绑定已存在也不该被取到。
        await expect(repository.listScheduleTriggers()).resolves.toEqual([]);

        await repository.updateCollectionPlan(created.planId, {
            enabled: true,
            baseRevisionId: created.planRevisionId,
        });
        await expect(repository.listScheduleTriggers()).resolves.toMatchObject([
            { planId: created.planId, sourceId: created.id, intervalMs: 60_000 },
        ]);

        // 来源行上的 enabled 列在读取切换后不再被读：即使它还是 0，计划启用就该调度。
        await repository.prisma.sourceInstance.update({
            where: { id: created.id },
            data: { enabled: false },
        });
        await expect(repository.listScheduleTriggers()).resolves.toHaveLength(1);
    } finally {
        await repository.close();
    }
});

it("stops scheduling a plan whose source was deleted", async () => {
    const root = await mkdtemp(join(tmpdir(), "cosmos-plan-tombstone-test-"));
    temporaryRoots.push(root);
    prepareDatabase(root);

    const repository = new PrismaCosmosRepository({ dataRoot: root });
    await repository.initialize();

    try {
        const created = await repository.createSource({
            name: "Tombstone fixture",
            sourceDefinitionRef: "source.fixture-rss@1",
            operationId: "fetch",
            config: {},
            scheduleIntervalMs: 60_000,
        });
        const enabled = await repository.updateCollectionPlan(created.planId, {
            enabled: true,
            baseRevisionId: created.planRevisionId,
        });
        await expect(repository.listScheduleTriggers()).resolves.toHaveLength(1);

        await repository.deleteSource({
            sourceId: created.id,
            baseRevisionId: created.revisionId,
            idempotencyKey: "delete-tombstone-fixture",
            actor: "test",
            reason: "tombstone",
        });

        await expect(repository.listScheduleTriggers()).resolves.toEqual([]);
        // 墓碑来源的计划也停用：计划读投影不该把一个已删除的来源显示成「已启用」。
        await expect(repository.prisma.collectionPlan.findUniqueOrThrow({
            where: { id: created.planId },
        })).resolves.toMatchObject({ enabled: false });
        // 墓碑来源的计划对编辑命令等同不存在。
        await expect(repository.updateCollectionPlan(created.planId, {
            enabled: true,
            baseRevisionId: enabled.revisionId,
        })).rejects.toMatchObject({ code: "not_found" });
    } finally {
        await repository.close();
    }
});
