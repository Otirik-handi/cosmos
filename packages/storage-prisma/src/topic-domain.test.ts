import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { PrismaClient } from "@prisma/client";
import {
    StoryNotFoundError,
    TopicMergeConflictError,
    TopicMembershipNotFoundError,
    TopicNotFoundError,
    TopicRevisionConflictError,
} from "@cosmos/application";
import { afterEach, describe, expect, it } from "vitest";

import { PrismaCosmosRepository } from "./index.js";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Topic domain commands", () => {
    it("creates a topic with seed and versions revisions", async () => {
        const { repository, prisma } = await setup();
        try {
            const created = await repository.createTopic({
                title: "Jeff Dean 离职为什么轰动",
                purpose: "理解离职的来龙去脉",
                scope: null,
                seedStoryId: "story-a",
                actor: "user",
                reason: "start",
            });
            expect(created?.topic.title).toBe("Jeff Dean 离职为什么轰动");
            expect(created?.members).toEqual([
                expect.objectContaining({
                    storyId: "story-a",
                    role: "core",
                    removed: false,
                }),
            ]);

            const topicId = created!.topic.id;
            const read = await repository.topic(topicId);
            expect(read?.topic.revisionId).toBe(created?.topic.revisionId);

            // updateTopic appends only on display change; stale base conflicts.
            const updated = await repository.updateTopic({
                topicId,
                baseRevisionId: created!.topic.revisionId,
                title: "Jeff Dean 离职及后续影响",
                purpose: "理解离职的来龙去脉",
                scope: null,
                actor: "user",
                reason: "retitle",
            });
            expect(updated?.topic.revisionId).not.toBe(created?.topic.revisionId);
            const noOp = await repository.updateTopic({
                topicId,
                baseRevisionId: updated!.topic.revisionId,
                title: "Jeff Dean 离职及后续影响",
                purpose: "理解离职的来龙去脉",
                scope: null,
            });
            expect(noOp?.topic.revisionId).toBe(updated?.topic.revisionId);
            await expect(repository.updateTopic({
                topicId,
                baseRevisionId: created!.topic.revisionId,
                title: "Stale",
                purpose: "x",
                scope: null,
            })).rejects.toBeInstanceOf(TopicRevisionConflictError);

            await expect(repository.topic("topic-missing")).resolves.toBeNull();
            await expect(repository.updateTopic({
                topicId: "topic-missing",
                baseRevisionId: "x",
                title: "t",
                purpose: "p",
                scope: null,
            })).rejects.toBeInstanceOf(TopicNotFoundError);
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("manages members with idempotent add, role change, remove, and restore", async () => {
        const { repository, prisma } = await setup();
        try {
            const topic = await repository.createTopic({
                title: "Members",
                purpose: "p",
                scope: null,
                seedStoryId: "story-a",
            });
            const topicId = topic!.topic.id;

            await repository.addTopicMember({
                topicId,
                storyId: "story-b",
                role: "background",
                actor: "user",
                reason: "背景",
            });
            expect((await repository.topic(topicId))?.members).toHaveLength(2);
            await repository.addTopicMember({
                topicId,
                storyId: "story-b",
                role: "background",
            });
            expect((await repository.topic(topicId))?.members).toHaveLength(2);

            await repository.updateTopicMemberRole({
                topicId,
                storyId: "story-b",
                role: "analysis",
                actor: "user",
                reason: "是分析文",
            });
            expect((await repository.topic(topicId))?.members.find((m) => {
                return m.storyId === "story-b";
            })?.role).toBe("analysis");
            await repository.updateTopicMemberRole({
                topicId,
                storyId: "story-b",
                role: "analysis",
            });
            expect((await repository.topic(topicId))?.members.find((m) => {
                return m.storyId === "story-b";
            })?.role).toBe("analysis");

            await repository.removeTopicMember({
                topicId,
                storyId: "story-b",
                actor: "user",
                reason: "跑题了",
            });
            const removed = await repository.topic(topicId);
            expect(removed?.members.find((m) => m.storyId === "story-b")?.removed).toBe(true);
            await repository.removeTopicMember({ topicId, storyId: "story-b" });
            await expect(repository.updateTopicMemberRole({
                topicId,
                storyId: "story-b",
                role: "core",
            })).rejects.toBeInstanceOf(TopicMembershipNotFoundError);
            await repository.restoreTopicMember({
                topicId,
                storyId: "story-b",
                role: "core",
                actor: "user",
                reason: "重新纳入",
            });
            const restored = await repository.topic(topicId);
            expect(restored?.members.find((m) => m.storyId === "story-b")?.removed).toBe(false);
            expect(restored?.members.find((m) => m.storyId === "story-b")?.role).toBe("core");
            await repository.restoreTopicMember({
                topicId,
                storyId: "story-b",
                role: "core",
            });

            await expect(repository.addTopicMember({
                topicId,
                storyId: "story-missing",
                role: "core",
            })).rejects.toBeInstanceOf(StoryNotFoundError);
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("merges topics with member dedup and alias redirect", async () => {
        const { repository, prisma } = await setup();
        try {
            const topicOne = await repository.createTopic({
                title: "Topic One",
                purpose: "p1",
                scope: null,
                seedStoryId: "story-a",
            });
            const topicTwo = await repository.createTopic({
                title: "Topic Two",
                purpose: "p2",
                scope: null,
                seedStoryId: "story-b",
            });
            // story-c appears in both topics; canonical must keep its role on merge.
            await repository.addTopicMember({
                topicId: topicOne!.topic.id,
                storyId: "story-c",
                role: "core",
            });
            await repository.addTopicMember({
                topicId: topicTwo!.topic.id,
                storyId: "story-c",
                role: "background",
            });

            const merged = await repository.mergeTopics({
                canonicalTopicId: topicOne!.topic.id,
                obsoleteTopicIds: [topicTwo!.topic.id],
                actor: "user",
                reason: "同一话题",
            });
            expect(merged?.topic.id).toBe(topicOne?.topic.id);
            expect(merged?.members.map((m) => m.storyId).sort()).toEqual([
                "story-a",
                "story-b",
                "story-c",
            ]);
            expect(merged?.members.find((m) => m.storyId === "story-c")?.role).toBe("core");

            // old id redirects to canonical.
            const redirected = await repository.topic(topicTwo!.topic.id);
            expect(redirected?.topic.id).toBe(topicOne?.topic.id);
            const alias = await prisma.topicAlias.findUnique({
                where: { id: topicTwo!.topic.id },
            });
            expect(alias?.canonicalTopicId).toBe(topicOne?.topic.id);

            await expect(repository.mergeTopics({
                canonicalTopicId: topicOne!.topic.id,
                obsoleteTopicIds: [topicTwo!.topic.id],
            })).rejects.toBeInstanceOf(TopicMergeConflictError);
            await expect(repository.mergeTopics({
                canonicalTopicId: topicOne!.topic.id,
                obsoleteTopicIds: [topicOne!.topic.id],
            })).rejects.toBeInstanceOf(TopicMergeConflictError);
            await expect(repository.mergeTopics({
                canonicalTopicId: topicOne!.topic.id,
                obsoleteTopicIds: ["topic-missing"],
            })).rejects.toBeInstanceOf(TopicNotFoundError);
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("migrates topic memberships when Stories are merged (move and collision)", async () => {
        const { repository, prisma } = await setup();
        try {
            // Move path: topic has only story-b; merging story-b into story-a moves it.
            const topic = await repository.createTopic({
                title: "Move case",
                purpose: "p",
                scope: null,
                seedStoryId: "story-b",
            });
            await repository.mergeStories({
                canonicalStoryId: "story-a",
                obsoleteStoryIds: ["story-b"],
            });
            expect((await repository.topic(topic!.topic.id))?.members).toEqual([
                expect.objectContaining({ storyId: "story-a", role: "core" }),
            ]);

            // Collision path: topic has story-a (canonical) and story-c (obsolete);
            // merging keeps canonical role and drops the obsolete duplicate.
            const collision = await repository.createTopic({
                title: "Collision case",
                purpose: "p",
                scope: null,
                seedStoryId: "story-a",
            });
            await repository.addTopicMember({
                topicId: collision!.topic.id,
                storyId: "story-c",
                role: "core",
            });
            await repository.mergeStories({
                canonicalStoryId: "story-a",
                obsoleteStoryIds: ["story-c"],
            });
            const after = await repository.topic(collision!.topic.id);
            expect(after?.members).toHaveLength(1);
            expect(after?.members[0].storyId).toBe("story-a");

            const membershipEvents = await repository.events({
                afterSequence: 0,
                limit: 50,
            });
            expect(membershipEvents.some((event) => {
                return event.type === "topic.membership_merged.v1";
            })).toBe(true);
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("lists topics with active member counts", async () => {
        const { repository, prisma } = await setup();
        try {
            const topic = await repository.createTopic({
                title: "List me",
                purpose: "p",
                scope: null,
                seedStoryId: "story-a",
            });
            await repository.addTopicMember({
                topicId: topic!.topic.id,
                storyId: "story-b",
                role: "background",
            });
            await repository.removeTopicMember({
                topicId: topic!.topic.id,
                storyId: "story-b",
            });
            const page = await repository.listTopics({ limit: 10 });
            expect(page.items).toHaveLength(1);
            expect(page.items[0].memberCount).toBe(1);
            expect(page.items[0].title).toBe("List me");
            expect(page.nextCursor).toBeNull();
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });
});

async function setup(): Promise<{
    repository: PrismaCosmosRepository;
    prisma: PrismaClient;
}> {
    const root = await mkdtemp(join(tmpdir(), "cosmos-topic-domain-"));
    roots.push(root);
    const databasePath = join(root, "cosmos.sqlite");
    deployMigrations(databasePath);
    const prisma = new PrismaClient({
        datasources: { db: { url: sqliteUrl(databasePath) } },
    });
    const repository = new PrismaCosmosRepository({
        dataRoot: root,
        prisma,
    });
    await repository.initialize();
    await seedStories(prisma);
    return { repository, prisma };
}

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
        ["entry-c", "source-b"],
    ] as const) {
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
        await prisma.story.create({ data: { id: `story-${id.at(-1)}`, kind: "document" } });
        await prisma.storyRevision.create({
            data: {
                id: `rev-${id.at(-1)}-1`,
                storyId: `story-${id.at(-1)}`,
                revision: 1,
                fingerprint: `fp-story-${id.at(-1)}`,
                title: `Story ${id.at(-1)}`,
                summary: null,
            },
        });
        await prisma.story.update({
            where: { id: `story-${id.at(-1)}` },
            data: { currentRevisionId: `rev-${id.at(-1)}-1` },
        });
        await prisma.entry.update({
            where: { id },
            data: { storyId: `story-${id.at(-1)}`, currentRevisionId: `er-${id}-1` },
        });
    }
}

function deployMigrations(databasePath: string): void {
    execFileSync(process.execPath, [
        resolve(
            process.cwd(),
            "packages/storage-prisma/node_modules/prisma/build/index.js",
        ),
        "migrate",
        "deploy",
        "--schema",
        resolve(process.cwd(), "packages/storage-prisma/prisma/schema.prisma"),
    ], {
        env: { ...process.env, DATABASE_URL: sqliteUrl(databasePath) },
        stdio: "ignore",
    });
}

function sqliteUrl(databasePath: string): string {
    return `file:${databasePath.replaceAll("\\", "/")}`;
}
