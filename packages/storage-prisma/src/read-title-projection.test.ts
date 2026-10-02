import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { withRepository } from "./index.fixtures.js";

/*
 * 读取侧投影（Task 35 切片 3a/3b）。
 *
 * 话题页、Entity 页、整理页、系统产出页都要直接列出对象，而不是让用户面对裸 ID——
 * 判据 R3 禁止要求用户认内部标识符。本文件锁定六处投影行为，以及三件容易做错的事：
 * 批量解析不能退化成 N+1、被删除的目标按 null 投影而不是抛错、列表里的 producer
 * 必须跟随 Story 当前 Revision 而不是创建时的那一刻。
 */

describe("read-side title projection", () => {
    it("resolves the topic member's Story title", async () => {
        await withRepository("title-topic-member", async (repository, prisma) => {
            await seedStories(prisma);
            const created = await repository.createTopic({
                title: "离职与后续影响",
                purpose: "理解来龙去脉",
                scope: null,
                seedStoryId: "story-a",
                actor: "user",
                reason: "start",
            });
            await repository.addTopicMember({
                topicId: created!.topic.id,
                storyId: "story-b",
                role: "background",
                actor: "user",
            });

            const read = await repository.topic(created!.topic.id);

            expect(read?.members).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ storyId: "story-a", title: "Story a" }),
                    expect.objectContaining({ storyId: "story-b", title: "Story b" }),
                ]),
            );
        });
    });

    it("resolves the Entity's linked Story titles", async () => {
        await withRepository("title-entity-stories", async (repository, prisma) => {
            await seedStories(prisma);
            const entity = await repository.createEntity({ name: "Jeff Dean", type: "person" });
            await repository.linkStoryEntity({ storyId: "story-a", entityId: entity!.entity.id });
            await repository.linkStoryEntity({ storyId: "story-b", entityId: entity!.entity.id });

            const read = await repository.entity(entity!.entity.id);

            expect(read?.stories).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ storyId: "story-a", title: "Story a" }),
                    expect.objectContaining({ storyId: "story-b", title: "Story b" }),
                ]),
            );
        });
    });

    it("resolves favorite titles for both Stories and Entries", async () => {
        await withRepository("title-favorites", async (repository, prisma) => {
            await seedStories(prisma);
            await repository.setFavorite({ targetType: "story", targetId: "story-a" });
            await repository.setFavorite({ targetType: "entry", targetId: "entry-a" });

            const list = await repository.listFavorites();

            expect(list.items).toHaveLength(2);
            expect(list.items).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ targetType: "story", targetId: "story-a", title: "Story a" }),
                    // 条目标题来自 EntryRevision，与 Story 标题是两条不同的解析路径。
                    expect.objectContaining({ targetType: "entry", targetId: "entry-a", title: "entry-a" }),
                ]),
            );
        });
    });

    it("keeps a null title when the favorited target no longer exists", async () => {
        await withRepository("title-favorite-missing", async (repository, prisma) => {
            await seedStories(prisma);
            await repository.setFavorite({ targetType: "story", targetId: "story-a" });
            await prisma.story.delete({ where: { id: "story-a" } });

            const list = await repository.listFavorites();

            // 不抛错、不把裸 ID 当标题：界面要能表达「这条已经读不到了」。
            expect(list.items).toEqual([
                expect.objectContaining({ targetType: "story", targetId: "story-a", title: null }),
            ]);
        });
    });

    it("lists every annotation when no target is given, and filters when one is", async () => {
        await withRepository("title-annotations", async (repository, prisma) => {
            await seedStories(prisma);
            await repository.createAnnotation({
                targetType: "story",
                targetId: "story-a",
                body: "关于 A 的想法",
            });
            await repository.createAnnotation({
                targetType: "entry",
                targetId: "entry-b",
                body: "关于 B 条目的想法",
            });

            const all = await repository.listAnnotations({});
            expect(all.items).toHaveLength(2);
            expect([...all.items.map((item) => item.body)].sort()).toEqual([
                "关于 A 的想法",
                "关于 B 条目的想法",
            ]);

            // 带目标时行为与扩展前一致，且目标别名仍要解析。
            const filtered = await repository.listAnnotations({
                targetType: "story",
                targetId: "story-a",
            });
            expect(filtered.items).toHaveLength(1);
            expect(filtered.items[0]!.body).toBe("关于 A 的想法");
        });
    });

    it("projects the annotation's target title, and null once the target is gone", async () => {
        await withRepository("title-annotation-targets", async (repository, prisma) => {
            await seedStories(prisma);
            const topic = await repository.createTopic({
                title: "离职与后续影响",
                purpose: "理解来龙去脉",
                scope: null,
                seedStoryId: "story-a",
                actor: "user",
                reason: "start",
            });
            await repository.createAnnotation({
                targetType: "story",
                targetId: "story-a",
                body: "关于 A 的想法",
            });
            await repository.createAnnotation({
                targetType: "entry",
                targetId: "entry-b",
                body: "关于 B 条目的想法",
            });
            await repository.createAnnotation({
                targetType: "topic",
                targetId: topic!.topic.id,
                body: "关于话题的想法",
            });

            const all = await repository.listAnnotations({});
            expect([...all.items.map((item) => item.targetTitle)].sort()).toEqual([
                "Story a",
                "entry-b",
                "离职与后续影响",
            ].sort());

            // 目标被删除后按 null 投影，界面据此说「已不可读」，而不是显示裸 ID。
            await prisma.story.delete({ where: { id: "story-a" } });
            const afterDelete = await repository.listAnnotations({});
            expect(afterDelete.items.find((item) => item.body === "关于 A 的想法")?.targetTitle)
                .toBeNull();
        });
    });

    it("projects the Story revision producer onto list items", async () => {
        await withRepository("title-producer", async (repository, prisma) => {
            await seedStories(prisma);
            // 播种出的 Story Revision 没有显式 producer，按 ADR-0028 的服务端赋值语义
            // 它们落成 system（默认值只声称最少）。
            const ingested = await repository.feed({ limit: 20 });
            expect(ingested.items).toHaveLength(2);
            expect(ingested.items.map((item) => `${item.storyId}:${String(item.producer)}`).sort()).toEqual([
                "story-a:system",
                "story-b:system",
            ]);

            // 人工编辑后该 Story 的当前 Revision 属于 human，列表投影必须跟着变——
            // 系统产出页据此区分「系统/Agent 产生的」与「人工写的」。
            const detail = await repository.story("story-a");
            await repository.updateStoryRevision({
                storyId: "story-a",
                baseRevisionId: detail!.story.revisionId,
                title: "人工改过的标题",
                summary: null,
                kind: "document",
                subtype: null,
                timeRange: null,
                keyFacts: null,
                actor: "user",
                reason: "test",
            });

            const after = await repository.feed({ limit: 20 });
            expect(after.items.find((item) => item.storyId === "story-a")?.producer).toBe("human");
            expect(after.items.find((item) => item.storyId === "story-b")?.producer).toBe("system");
        });
    });
});

async function seedStories(prisma: PrismaClient): Promise<void> {
    for (const id of ["source-a", "source-b"]) {
        await prisma.sourceInstance.create({
            data: {
                id,
                name: id,
                kind: "rss",
                sourceDefinitionRef: "source.rss@1",
                operationId: "fetch",
                configJson: "{}",
                enabled: true,
            },
        });
    }
    for (const [id, sourceId] of [
        ["entry-a", "source-a"],
        ["entry-b", "source-b"],
    ] as const) {
        const suffix = id.at(-1)!;
        await prisma.entry.create({
            data: {
                id,
                sourceInstanceId: sourceId,
                canonicalExternalId: `external:${id}`,
            },
        });
        await prisma.entryRevision.create({
            data: {
                id: `er-${id}-1`,
                entryId: id,
                revision: 1,
                title: id,
                contentText: `${id} body`,
                contentFingerprint: `fp-${id}`,
            },
        });
        await prisma.story.create({ data: { id: `story-${suffix}`, kind: "document" } });
        await prisma.storyRevision.create({
            data: {
                id: `rev-${suffix}-1`,
                storyId: `story-${suffix}`,
                revision: 1,
                fingerprint: `fp-story-${suffix}`,
                title: `Story ${suffix}`,
                summary: null,
            },
        });
        await prisma.story.update({
            where: { id: `story-${suffix}` },
            data: { currentRevisionId: `rev-${suffix}-1` },
        });
        await prisma.entry.update({
            where: { id },
            data: { storyId: `story-${suffix}`, currentRevisionId: `er-${id}-1` },
        });
    }
}
