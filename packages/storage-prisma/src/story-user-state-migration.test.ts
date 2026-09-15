import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { PrismaClient } from "@prisma/client";
import { StoryUserStateMigrationConflictError } from "@cosmos/application";
import { afterEach, describe, expect, it } from "vitest";

import { PrismaCosmosRepository } from "./index.js";

const roots: string[] = [];
const clients = new Set<PrismaClient>();

afterEach(async () => {
    await Promise.all([...clients].map((client) => client.$disconnect()));
    clients.clear();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Story user-state migration", () => {
    it("moves only the named Story-target state and leaves the rest on the shell", async () => {
        const { repository, prisma } = await setup();
        try {
            const family = await seedSplitFamily(repository, prisma);

            const result = await repository.migrateStoryUserState({
                sourceStoryId: "story-shell",
                targetStoryId: family.successorAId,
                favorite: true,
                labelIds: [family.labelAId],
                collectionIds: [family.collectionId],
                annotationIds: [family.annotationId],
                spotlightPlacementIds: [family.placementId],
                actor: "user",
                reason: "拆分后把标记归到主事件",
                basis: "entry-a 才是主事件",
            });

            expect(result).toMatchObject({
                sourceStoryId: "story-shell",
                targetStoryId: family.successorAId,
                favorite: { moved: 1, deduped: 0 },
                labelAssignments: { moved: 1, deduped: 0 },
                collectionItems: { moved: 1, deduped: 0 },
                annotations: { moved: 1, deduped: 0 },
                spotlightPlacements: { moved: 1, deduped: 0 },
            });

            const successor = await repository.story(family.successorAId);
            expect(successor?.favorited).toBe(true);
            expect(successor?.labels.map((label) => label.name)).toEqual(["分类 A"]);
            expect((await prisma.collectionItem.findFirst({
                where: { collectionId: family.collectionId },
            }))?.storyId).toBe(family.successorAId);
            expect((await prisma.annotation.findUnique({
                where: { id: family.annotationId },
            }))?.targetId).toBe(family.successorAId);
            expect((await prisma.spotlightPlacement.findUnique({
                where: { id: family.placementId },
            }))?.targetId).toBe(family.successorAId);

            // The shell is still a shell, and it keeps everything that was not named.
            const shell = await repository.story("story-shell");
            expect(shell?.story.status).toBe("split");
            expect(shell?.favorited).toBe(false);
            expect(shell?.labels.map((label) => label.name)).toEqual(["分类 B"]);

            // One audit event carries the selection's outcome and its basis.
            const events = await prisma.domainEvent.findMany({
                where: { type: "story.user_state_migrated.v1" },
            });
            expect(events).toHaveLength(1);
            expect(JSON.parse(events[0]!.payloadJson)).toMatchObject({
                sourceStoryId: "story-shell",
                targetStoryId: family.successorAId,
                favorite: { moved: 1, deduped: 0 },
                annotations: { moved: 1, deduped: 0 },
                actor: "user",
                reason: "拆分后把标记归到主事件",
                basis: "entry-a 才是主事件",
            });
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("treats the reverse direction as the undo", async () => {
        const { repository, prisma } = await setup();
        try {
            const family = await seedSplitFamily(repository, prisma);
            const selection = {
                favorite: true,
                labelIds: [family.labelAId],
                collectionIds: [family.collectionId],
                annotationIds: [family.annotationId],
                spotlightPlacementIds: [family.placementId],
            };
            await repository.migrateStoryUserState({
                sourceStoryId: "story-shell",
                targetStoryId: family.successorAId,
                ...selection,
            });

            const back = await repository.migrateStoryUserState({
                sourceStoryId: family.successorAId,
                targetStoryId: "story-shell",
                ...selection,
                actor: "user",
                reason: "归错了后继",
            });

            expect(back.favorite).toEqual({ moved: 1, deduped: 0 });
            expect(back.labelAssignments).toEqual({ moved: 1, deduped: 0 });
            expect(back.collectionItems).toEqual({ moved: 1, deduped: 0 });
            expect(back.annotations).toEqual({ moved: 1, deduped: 0 });
            expect(back.spotlightPlacements).toEqual({ moved: 1, deduped: 0 });

            const shell = await repository.story("story-shell");
            expect(shell?.favorited).toBe(true);
            expect(shell?.labels.map((label) => label.name).sort()).toEqual(["分类 A", "分类 B"]);
            const successor = await repository.story(family.successorAId);
            expect(successor?.favorited).toBe(false);
            expect(successor?.labels).toEqual([]);
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("lets the target's own row win when the same state is already there", async () => {
        const { repository, prisma } = await setup();
        try {
            const family = await seedSplitFamily(repository, prisma);
            await repository.setFavorite({ targetType: "story", targetId: family.successorAId });
            await repository.attachLabel({
                labelId: family.labelAId,
                targetType: "story",
                targetId: family.successorAId,
            });
            await repository.addCollectionItem({
                collectionId: family.collectionId,
                storyId: family.successorAId,
            });
            await repository.createSpotlightPlacement({
                boardId: family.boardId,
                targetType: "story",
                targetId: family.successorAId,
            });

            const result = await repository.migrateStoryUserState({
                sourceStoryId: "story-shell",
                targetStoryId: family.successorAId,
                favorite: true,
                labelIds: [family.labelAId],
                collectionIds: [family.collectionId],
                annotationIds: [],
                spotlightPlacementIds: [family.placementId],
            });

            expect(result.favorite).toEqual({ moved: 0, deduped: 1 });
            expect(result.labelAssignments).toEqual({ moved: 0, deduped: 1 });
            expect(result.collectionItems).toEqual({ moved: 0, deduped: 1 });
            expect(result.spotlightPlacements).toEqual({ moved: 0, deduped: 1 });
            // Exactly one row per unique key survives, on the target.
            expect(await prisma.favorite.count({
                where: { targetType: "story", targetId: family.successorAId },
            })).toBe(1);
            expect(await prisma.labelAssignment.count({
                where: { labelId: family.labelAId, targetType: "story", targetId: family.successorAId },
            })).toBe(1);
            expect(await prisma.collectionItem.count({
                where: { collectionId: family.collectionId },
            })).toBe(1);
            expect(await prisma.spotlightPlacement.count({
                where: { boardId: family.boardId },
            })).toBe(1);
            // The deduped rows are gone from the shell.
            expect(await prisma.favorite.count({
                where: { targetType: "story", targetId: "story-shell" },
            })).toBe(0);
            expect(await prisma.labelAssignment.count({
                where: { targetType: "story", targetId: "story-shell" },
            })).toBe(1);
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("stays inside one split family", async () => {
        const { repository, prisma } = await setup();
        try {
            const family = await seedSplitFamily(repository, prisma);
            const base = {
                favorite: true,
                labelIds: [] as string[],
                collectionIds: [] as string[],
                annotationIds: [] as string[],
                spotlightPlacementIds: [] as string[],
            };

            // Unrelated Story, in both directions.
            await expect(repository.migrateStoryUserState({
                ...base,
                sourceStoryId: "story-shell",
                targetStoryId: "story-other",
            })).rejects.toThrow(StoryUserStateMigrationConflictError);
            await expect(repository.migrateStoryUserState({
                ...base,
                sourceStoryId: "story-other",
                targetStoryId: family.successorAId,
            })).rejects.toThrow(StoryUserStateMigrationConflictError);
            // A Story in no split family at all is not a source either.
            await expect(repository.migrateStoryUserState({
                ...base,
                sourceStoryId: "story-other",
                targetStoryId: "story-other",
            })).rejects.toThrow(StoryUserStateMigrationConflictError);
            // Same Story on both ends.
            await expect(repository.migrateStoryUserState({
                ...base,
                sourceStoryId: "story-shell",
                targetStoryId: "story-shell",
            })).rejects.toThrow(StoryUserStateMigrationConflictError);

            // Successor to successor is inside the family, so it is allowed.
            // The favorite is still on the shell here, so it is not part of this
            // move: only state the source Story actually carries can be named.
            const between = await repository.migrateStoryUserState({
                ...base,
                favorite: false,
                sourceStoryId: family.successorAId,
                targetStoryId: family.successorBId,
            });
            expect(between).toMatchObject({ sourceStoryId: family.successorAId, targetStoryId: family.successorBId });

            // Nothing was moved by the rejected commands.
            expect(await prisma.favorite.count({
                where: { targetType: "story", targetId: "story-shell" },
            })).toBe(1);
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("rejects a named row that is not on the source Story", async () => {
        const { repository, prisma } = await setup();
        try {
            const family = await seedSplitFamily(repository, prisma);
            // A label of another Story, and a label attached to an Entry rather
            // than to a Story: neither can be named as Story-target state.
            const foreignLabel = await repository.createLabel({ name: "分类 C" });
            await repository.attachLabel({
                labelId: foreignLabel.id,
                targetType: "story",
                targetId: "story-other",
            });
            await repository.attachLabel({
                labelId: foreignLabel.id,
                targetType: "entry",
                targetId: "entry-a",
            });
            const base = {
                sourceStoryId: "story-shell",
                targetStoryId: family.successorAId,
                favorite: false,
                labelIds: [] as string[],
                collectionIds: [] as string[],
                annotationIds: [] as string[],
                spotlightPlacementIds: [] as string[],
            };

            await expect(repository.migrateStoryUserState({
                ...base,
                labelIds: [foreignLabel.id],
            })).rejects.toThrow(StoryUserStateMigrationConflictError);
            await expect(repository.migrateStoryUserState({
                ...base,
                collectionIds: ["collection-unknown"],
            })).rejects.toThrow(StoryUserStateMigrationConflictError);
            await expect(repository.migrateStoryUserState({
                ...base,
                annotationIds: [family.annotationId, "annotation-unknown"],
            })).rejects.toThrow(StoryUserStateMigrationConflictError);
            await expect(repository.migrateStoryUserState({
                ...base,
                spotlightPlacementIds: ["placement-unknown"],
            })).rejects.toThrow(StoryUserStateMigrationConflictError);
            // Asking for a favorite the shell does not have is a conflict too.
            await expect(repository.migrateStoryUserState({
                ...base,
                favorite: true,
                sourceStoryId: family.successorAId,
            })).rejects.toThrow(StoryUserStateMigrationConflictError);

            // A rejected command changes nothing and writes no migration event.
            expect(await prisma.labelAssignment.count({
                where: { targetType: "story", targetId: "story-shell" },
            })).toBe(2);
            expect(await prisma.annotation.count({
                where: { targetId: "story-shell" },
            })).toBe(1);
            expect(await prisma.domainEvent.count({
                where: { type: "story.user_state_migrated.v1" },
            })).toBe(0);
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("never touches state whose target is an Entry", async () => {
        const { repository, prisma } = await setup();
        try {
            const family = await seedSplitFamily(repository, prisma);
            // entry-a moved to successor A during the split; state hung on the
            // Entry follows the Entry, not the Story.
            await repository.setFavorite({ targetType: "entry", targetId: "entry-a" });
            await repository.attachLabel({
                labelId: family.labelBId,
                targetType: "entry",
                targetId: "entry-a",
            });

            const result = await repository.migrateStoryUserState({
                sourceStoryId: "story-shell",
                targetStoryId: family.successorBId,
                favorite: true,
                labelIds: [family.labelBId],
                collectionIds: [],
                annotationIds: [],
                spotlightPlacementIds: [],
            });

            expect(result.favorite).toEqual({ moved: 1, deduped: 0 });
            expect(result.labelAssignments).toEqual({ moved: 1, deduped: 0 });
            // The Story-target rows are on the successor now.
            expect(await prisma.favorite.count({
                where: { targetType: "story", targetId: family.successorBId },
            })).toBe(1);
            expect(await prisma.labelAssignment.count({
                where: { labelId: family.labelBId, targetType: "story", targetId: family.successorBId },
            })).toBe(1);
            // The Entry-target rows never moved.
            expect(await prisma.favorite.count({
                where: { targetType: "entry", targetId: "entry-a" },
            })).toBe(1);
            expect(await prisma.labelAssignment.count({
                where: { labelId: family.labelBId, targetType: "entry", targetId: "entry-a" },
            })).toBe(1);
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("treats an empty selection as a no-op with no audit event", async () => {
        const { repository, prisma } = await setup();
        try {
            const family = await seedSplitFamily(repository, prisma);

            const result = await repository.migrateStoryUserState({
                sourceStoryId: "story-shell",
                targetStoryId: family.successorAId,
                favorite: false,
                labelIds: [],
                collectionIds: [],
                annotationIds: [],
                spotlightPlacementIds: [],
            });

            expect(result.favorite).toEqual({ moved: 0, deduped: 0 });
            expect(result.annotations).toEqual({ moved: 0, deduped: 0 });
            expect(await prisma.domainEvent.count({
                where: { type: "story.user_state_migrated.v1" },
            })).toBe(0);
            expect((await repository.story("story-shell"))?.favorited).toBe(true);
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
    const root = await mkdtemp(join(tmpdir(), "cosmos-story-user-state-"));
    roots.push(root);
    const databasePath = join(root, "cosmos.sqlite");
    deployMigrations(
        databasePath,
        resolve(process.cwd(), "packages/storage-prisma/prisma/schema.prisma"),
    );
    const prisma = new PrismaClient({
        datasources: { db: { url: sqliteUrl(databasePath) } },
    });
    clients.add(prisma);
    const repository = new PrismaCosmosRepository({ dataRoot: root, prisma });
    await repository.initialize();
    return { repository, prisma };
}

interface SplitFamily {
    successorAId: string;
    successorBId: string;
    labelAId: string;
    labelBId: string;
    collectionId: string;
    annotationId: string;
    placementId: string;
    boardId: string;
}

/**
 * A shell carrying one of every Story-target user state, split into two
 * successors. After the split that state is still on the shell, which is
 * exactly the dislocation the migration command exists to resolve.
 */
async function seedSplitFamily(
    repository: PrismaCosmosRepository,
    prisma: PrismaClient,
): Promise<SplitFamily> {
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
    for (const [storyId, title] of [
        ["story-shell", "被错误合并的 Story"],
        ["story-other", "无关 Story"],
    ] as const) {
        await prisma.story.create({ data: { id: storyId, kind: "event" } });
        await prisma.storyRevision.create({
            data: {
                id: `rev-${storyId}`,
                storyId,
                revision: 1,
                fingerprint: `fp-${storyId}`,
                title,
                summary: null,
            },
        });
        await prisma.story.update({
            where: { id: storyId },
            data: { currentRevisionId: `rev-${storyId}` },
        });
    }
    for (const entryId of ["entry-a", "entry-b"] as const) {
        await prisma.entry.create({
            data: {
                id: entryId,
                sourceInstanceId: "source-a",
                canonicalExternalId: `external:${entryId}`,
            },
        });
        await prisma.entryRevision.create({
            data: {
                id: `er-${entryId}`,
                entryId,
                revision: 1,
                title: entryId,
                contentText: `${entryId} body`,
                contentFingerprint: `fp-${entryId}`,
            },
        });
        await prisma.entry.update({
            where: { id: entryId },
            data: { storyId: "story-shell", currentRevisionId: `er-${entryId}` },
        });
    }

    const labelA = await repository.createLabel({ name: "分类 A" });
    const labelB = await repository.createLabel({ name: "分类 B" });
    await repository.attachLabel({ labelId: labelA.id, targetType: "story", targetId: "story-shell" });
    await repository.attachLabel({ labelId: labelB.id, targetType: "story", targetId: "story-shell" });
    await repository.setFavorite({ targetType: "story", targetId: "story-shell" });
    const annotation = await repository.createAnnotation({
        targetType: "story",
        targetId: "story-shell",
        body: "我的批注",
    });
    const collection = await repository.createCollection({ name: "收藏夹 A" });
    await repository.addCollectionItem({ collectionId: collection.id, storyId: "story-shell" });
    const board = await repository.createBoard({ name: "看板 A" });
    const placement = await repository.createSpotlightPlacement({
        boardId: board.id,
        targetType: "story",
        targetId: "story-shell",
    });

    const split = await repository.splitStory({
        storyId: "story-shell",
        successors: [
            {
                title: "事件 A",
                summary: null,
                kind: "event",
                subtype: null,
                entryIds: ["entry-a"],
                evidenceEntryIds: [],
                entityIds: [],
                topicIds: [],
            },
            {
                title: "事件 B",
                summary: null,
                kind: "event",
                subtype: null,
                entryIds: ["entry-b"],
                evidenceEntryIds: [],
                entityIds: [],
                topicIds: [],
            },
        ],
        actor: "user",
        reason: "两个事件被错误合并",
    });
    return {
        successorAId: split!.story.replacedBy[0]!.storyId,
        successorBId: split!.story.replacedBy[1]!.storyId,
        labelAId: labelA.id,
        labelBId: labelB.id,
        collectionId: collection.id,
        annotationId: annotation.id,
        placementId: placement.id,
        boardId: board.id,
    };
}

function deployMigrations(databasePath: string, schemaPath: string): void {
    execFileSync(process.execPath, [
        resolve(
            process.cwd(),
            "packages/storage-prisma/node_modules/prisma/build/index.js",
        ),
        "migrate",
        "deploy",
        "--schema",
        schemaPath,
    ], {
        env: { ...process.env, DATABASE_URL: sqliteUrl(databasePath) },
        stdio: "ignore",
    });
}

function sqliteUrl(databasePath: string): string {
    return `file:${databasePath.replaceAll("\\", "/")}`;
}
