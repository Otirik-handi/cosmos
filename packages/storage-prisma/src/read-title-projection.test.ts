import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { withRepository } from "./index.fixtures.js";

/*
 * 读取侧标题投影（Task 35 切片 3a）。
 *
 * 话题页、Entity 页、整理页都要直接列出对象，而不是让用户面对裸 ID——判据 R3
 * 禁止要求用户认内部标识符。本文件锁定四处的投影行为，以及两件容易做错的事：
 * 批量解析不能退化成 N+1、被删除的目标按 null 投影而不是抛错。
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
