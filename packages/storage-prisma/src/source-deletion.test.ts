import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { IngestionService, SourceRevisionConflictError, type IngestConnector } from "@cosmos/application";
import type { NormalizedIngestItem } from "@cosmos/domain";
import { PrismaCosmosRepository } from "./index.js";
import { createFixtureSource, prepareDatabase, temporaryRoots } from "./index.fixtures.js";

/**
 * AUT-001 删除来源：墓碑语义。
 *
 * 删除只移除来源配置与调度绑定；已录入的 Entry/Observation/Revision 必须保留
 * （Entry.sourceInstanceId 是必填级联外键，硬删会连带删掉全部历史）。
 */
async function setup(): Promise<{
    repository: PrismaCosmosRepository;
    sourceId: string;
    revisionId: string;
    entryId: string;
}> {
    const root = await mkdtemp(join(tmpdir(), "cosmos-source-deletion-"));
    temporaryRoots.push(root);
    prepareDatabase(root);

    const repository = new PrismaCosmosRepository({ dataRoot: root });
    await repository.initialize();
    const source = await createFixtureSource(repository, {
        name: "To be deleted",
        config: {},
        scheduleIntervalMs: 1_800_000,
    });
    const item: NormalizedIngestItem = {
        externalId: "kept-entry",
        title: "删除来源后仍应存在",
        summary: null,
        contentText: "正文",
        webUrl: null,
        kind: "article",
        publisher: null,
        metrics: null,
        publishedAt: null,
        updatedAt: null,
        sourceLocator: { provider: "fixture", item: "kept-entry" },
        rawPayload: "<item>kept-entry</item>",
        assets: [],
    };
    const connector: IngestConnector = {
        id: "test-fixture",
        description: "Test fixture",
        configVersion: "v1",
        capabilities: ["test"],
        validate: () => undefined,
        async fetchItems() {
            return { items: [item], nextCursor: null };
        },
    };
    await new IngestionService(repository, () => connector).runSource(source.id);
    const entries = await repository.entries({ sourceId: source.id, limit: 10 });
    expect(entries.items).toHaveLength(1);
    // 来源必须先启用才会进入调度；这里直接断言绑定存在。
    expect(await repository.listScheduleTriggers()).toHaveLength(1);

    return { repository, sourceId: source.id, revisionId: source.revisionId, entryId: entries.items[0]!.id };
}

it("deletes the source but keeps its ingested history (AUT-001)", async () => {
    const { repository, sourceId, revisionId, entryId } = await setup();
    try {
        const deleted = await repository.deleteSource({
            sourceId,
            baseRevisionId: revisionId,
            idempotencyKey: "delete-1",
            actor: "user",
            reason: "不再关注这个来源",
        });

        // 墓碑：来源从产品面消失。
        expect(await repository.getSource(sourceId)).toBeNull();
        expect((await repository.listSources()).map((source) => source.id)).not.toContain(sourceId);
        // 调度绑定随删除移除。
        expect(await repository.listScheduleTriggers()).toEqual([]);
        // 已录入历史完整保留，且仍能溯源到（已删除的）来源。
        const detail = await repository.entry(entryId);
        expect(detail?.revisions[0]?.title).toBe("删除来源后仍应存在");
        expect(detail?.sourceId).toBe(sourceId);
        expect(detail?.observations).toHaveLength(1);
        expect((await repository.entries({ sourceId, limit: 10 })).items).toHaveLength(1);
        // 审计事件记录了 actor/reason（ORG-010）。
        const event = await repository.prisma.domainEvent.findFirst({
            where: { type: "source.deleted.v1" },
        });
        expect(event?.payloadJson).toContain("不再关注这个来源");

        // 幂等：重复删除返回同一份墓碑快照，不再改 revision。
        const again = await repository.deleteSource({
            sourceId,
            baseRevisionId: revisionId,
            idempotencyKey: "delete-2",
            actor: null,
            reason: null,
        });
        expect(again.revisionId).toBe(deleted.revisionId);
        expect(await repository.prisma.domainEvent.count({
            where: { type: "source.deleted.v1" },
        })).toBe(1);
    } finally {
        await repository.close();
    }
});

it("drops the collection plan from the list projection when its source is deleted (AUT-001)", async () => {
    const { repository, sourceId, revisionId } = await setup();
    try {
        // 反例先行：删除前计划必须在投影里，否则「删除后消失」是空断言。
        const before = await repository.listCollectionPlans();
        const planId = before.find((plan) => plan.sourceId === sourceId)?.id;
        expect(planId).toBeDefined();

        await repository.deleteSource({
            sourceId,
            baseRevisionId: revisionId,
            idempotencyKey: "delete-plan-projection",
            actor: null,
            reason: null,
        });

        // 看板的「采集计划」行由这个投影驱动。计划行本身仍在库里（只被停用），
        // 消失靠的是 listCollectionPlans 的 `source: { deletedAt: null }` 墓碑过滤。
        const after = await repository.listCollectionPlans();
        expect(after.map((plan) => plan.id)).not.toContain(planId);
        expect(after.map((plan) => plan.sourceId)).not.toContain(sourceId);
        const row = await repository.prisma.collectionPlan.findUnique({ where: { id: planId! } });
        expect(row?.enabled).toBe(false);
    } finally {
        await repository.close();
    }
});

it("rejects a stale revision and hides the tombstone from edit commands", async () => {
    const { repository, sourceId, revisionId } = await setup();
    try {
        await expect(repository.deleteSource({
            sourceId,
            baseRevisionId: `${sourceId}:99`,
            idempotencyKey: "delete-stale",
            actor: null,
            reason: null,
        })).rejects.toBeInstanceOf(SourceRevisionConflictError);

        await repository.deleteSource({
            sourceId,
            baseRevisionId: revisionId,
            idempotencyKey: "delete-ok",
            actor: null,
            reason: null,
        });

        // 墓碑来源对编辑命令等同不存在。
        await expect(repository.updateSource(sourceId, {
            baseRevisionId: revisionId,
            name: "renamed",
        })).rejects.toThrow();
    } finally {
        await repository.close();
    }
});
