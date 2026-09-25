import { PrismaClient } from "@prisma/client";
import { userDataExportSchema } from "@cosmos/contracts";
import { describe, expect, it } from "vitest";

import { PrismaCosmosRepository } from "./index.js";
import { withRepository } from "./index.fixtures.js";

describe("user data export (LIB-008 / OPS-004)", () => {
    it("bundles user truth objects with resolved reference targets", async () => {
        await withRepository("user-data-export", async (repository, prisma) => {
            await seedStory(prisma);
            const label = await repository.createLabel({ name: "关注" });
            await repository.attachLabel({ labelId: label.id, targetType: "story", targetId: "story-a" });
            await repository.attachLabel({ labelId: label.id, targetType: "entry", targetId: "entry-a" });

            const collection = await repository.createCollection({ name: "稍后读", description: null });
            await repository.addCollectionItem({ collectionId: collection.id, storyId: "story-a" });
            await repository.setFavorite({ targetType: "entry", targetId: "entry-a" });
            await repository.createAnnotation({
                targetType: "story",
                targetId: "story-a",
                body: "这条值得跟进",
                quote: null,
                evidence: null,
                actor: null,
            });
            const topic = await repository.createTopic({ title: "Jeff Dean 去向", purpose: "跟踪去向", scope: null });
            const topicId = topic!.topic.id;
            await repository.createSavedView({ name: "只看该 Topic", conditions: { topicIds: [topicId] } });
            const board = await repository.ensureDefaultBoard();
            await repository.createSpotlightPlacement({
                boardId: board.id,
                targetType: "story",
                targetId: "story-a",
            });

            const payload = await repository.exportUserData();

            // 导出件必须是可校验的公开合同，且计数与实际分区一致。
            expect(userDataExportSchema.parse(payload)).toEqual(payload);
            expect(payload.schemaVersion).toBe(1);
            expect(payload.exportedAt).toBe(new Date(payload.exportedAt).toISOString());
            expect(payload.counts).toEqual({
                labels: 1,
                collections: 1,
                favorites: 1,
                annotations: 1,
                savedViews: 1,
                boards: 1,
                spotlightPlacements: 1,
                targets: 3,
            });

            expect(payload.data.labels[0]?.assignedStories).toEqual([{ id: "story-a", title: "Story a" }]);
            expect(payload.data.collections[0]?.stories.map((story) => story.storyId)).toEqual(["story-a"]);
            expect(payload.data.annotations[0]?.body).toBe("这条值得跟进");
            expect(payload.data.savedViews[0]?.topicIds).toEqual([topicId]);
            expect(payload.data.boards[0]?.sections.length).toBeGreaterThan(0);
            expect(payload.data.spotlightPlacements[0]?.targetId).toBe("story-a");

            // 目标摘要让 id 在 Cosmos 之外仍可读：标题来自当前 revision，链接来自条目。
            const targets = payload.data.targets.map((target) => `${target.targetType}:${target.targetId}`);
            expect(targets).toEqual(["entry:entry-a", `story:story-a`, `topic:${topicId}`]);
            const entryTarget = payload.data.targets.find((target) => target.targetType === "entry");
            expect(entryTarget?.title).toBe("entry-a");
            expect(entryTarget?.webUrl).toBe("https://example.com/entry-a");
        });
    });

    it("excludes secrets, connections, sources and internal storage keys", async () => {
        await withRepository("user-data-export", async (repository, prisma) => {
            await seedStory(prisma);
            await prisma.connectionInstance.create({
                data: {
                    id: "conn-1",
                    name: "B 站登录",
                    connectorId: "source.bilibili@1",
                    secretRef: "secret:conn-1",
                },
            });
            await prisma.connectorState.create({
                data: { namespace: "source:source-a", key: "etag", valueJson: "\"etag-1\"" },
            });
            await repository.createLabel({ name: "关注" });

            const payload = await repository.exportUserData();
            const text = JSON.stringify(payload);

            // 结构断言：导出只有这八个分区，没有第二个「来源/连接/状态」入口。
            expect(Object.keys(payload.data)).toEqual([
                "labels",
                "collections",
                "favorites",
                "annotations",
                "savedViews",
                "boards",
                "spotlightPlacements",
                "targets",
            ]);
            // 内容断言：连接、连接器状态与 Secret 引用一律不出现（本 fixture 里没有任何
            // 用户对象引用 source-a，所以来源 id 也不该被带出来）。
            expect(text).not.toContain("secret:conn-1");
            expect(text).not.toContain("secretRef");
            expect(text).not.toContain("conn-1");
            expect(text).not.toContain("source-a");
            expect(text).not.toContain("etag-1");
            expect(text).not.toContain("storageKey");
        });
    });

    it("keeps dangling references and stays deterministic across exports", async () => {
        await withRepository("user-data-export", async (repository, prisma) => {
            await seedStory(prisma);
            await repository.createLabel({ name: "乙" });
            await repository.createLabel({ name: "甲" });
            // Favorite 没有外键，目标 Story 被删后引用仍然留在用户数据里。
            await prisma.favorite.create({
                data: { targetType: "story", targetId: "story-missing" },
            });

            const first = await repository.exportUserData();
            const second = await repository.exportUserData();

            expect(first.data).toEqual(second.data);
            expect(first.data.labels.map((label) => label.name)).toEqual(["乙", "甲"]);
            expect(first.data.targets).toEqual([{
                targetType: "story",
                targetId: "story-missing",
                title: null,
                webUrl: null,
            }]);
        });
    });
});

async function seedStory(prisma: PrismaClient): Promise<void> {
    await prisma.sourceInstance.create({
        data: {
            id: "source-a",
            name: "source-a",
            kind: "rss",
            sourceDefinitionRef: "source.rss@1",
            operationId: "fetch",
            configJson: "{}",
            enabled: true,
        },
    });
    await prisma.entry.create({
        data: {
            id: "entry-a",
            sourceInstanceId: "source-a",
            canonicalExternalId: "external:entry-a",
        },
    });
    await prisma.entryRevision.create({
        data: {
            id: "er-entry-a-1",
            entryId: "entry-a",
            revision: 1,
            title: "entry-a",
            contentText: "entry-a body",
            contentFingerprint: "fp-entry-a",
            webUrl: "https://example.com/entry-a",
        },
    });
    await prisma.story.create({ data: { id: "story-a", kind: "document" } });
    await prisma.storyRevision.create({
        data: {
            id: "rev-story-a-1",
            storyId: "story-a",
            revision: 1,
            fingerprint: "fp-story-a",
            title: "Story a",
            summary: null,
        },
    });
    await prisma.story.update({
        where: { id: "story-a" },
        data: { currentRevisionId: "rev-story-a-1" },
    });
    await prisma.entry.update({
        where: { id: "entry-a" },
        data: { storyId: "story-a", currentRevisionId: "er-entry-a-1" },
    });
}
