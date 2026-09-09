import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { PrismaClient } from "@prisma/client";
import {
    StoryMergeConflictError,
    StoryRevisionConflictError,
    StorySplitConflictError,
} from "@cosmos/application";
import { afterEach, describe, expect, it } from "vitest";

import { PrismaCosmosRepository } from "./index.js";

const roots: string[] = [];
const clients = new Set<PrismaClient>();

afterEach(async () => {
    await Promise.all([...clients].map((client) => client.$disconnect()));
    clients.clear();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** Everything before the Story split migration. */
const legacyMigrations = [
    "20260808003247_phase1_foundation",
    "20260808150000_collector_jobs",
    "20260810020829_normalized_content_model",
    "20260813160000_workflow_run_backend",
    "20260814090000_workflow_activity_host",
    "20260815090000_workflow_ingest",
    "20260818000000_workflow_run_source_projection",
    "20260824000000_source_identity_revision",
    "20260824100000_source_activation_result_snapshot",
    "20260907120000_story_revision_versioning",
    "20260907130000_story_merge_alias",
    "20260908000000_topic_domain_v1",
    "20260908120000_entity_relation_v1",
    "20260908140000_user_organization_v1",
    "20260908160000_annotation_v1",
    "20260908180000_saved_view_v1",
    "20260909100000_board_section_block_v1",
    "20260909120000_spotlight_placement_v1",
    "20260909140000_entry_story_evidence_v1",
];

describe("Story split", () => {
    it("keeps a historical shell and moves only the explicitly mapped relations", async () => {
        const { repository, prisma } = await setup();
        try {
            const shell = await seedShell(repository, prisma);
            const entityA = shell.entities[0]!;
            const entityB = shell.entities[1]!;
            const topicA = shell.topics[0]!;
            const topicB = shell.topics[1]!;

            const split = await repository.splitStory({
                storyId: "story-shell",
                successors: [
                    {
                        title: "事件 A",
                        summary: "A 的摘要",
                        kind: "event",
                        subtype: null,
                        entryIds: ["entry-a"],
                        evidenceEntryIds: ["entry-d"],
                        entityIds: [entityA],
                        topicIds: [topicA],
                    },
                    {
                        title: "事件 B",
                        summary: null,
                        kind: "document",
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

            // The command returns the historical shell, not a successor.
            expect(split?.story.id).toBe("story-shell");
            expect(split?.story.status).toBe("split");
            expect(split?.story.replacedBy.map((successor) => successor.title))
                .toEqual(["事件 A", "事件 B"]);
            // entry-c was never assigned, so it stays on the shell as unresolved.
            expect(split?.entries.map((entry) => entry.id)).toEqual(["entry-c"]);
            expect(split?.entry?.id).toBe("entry-c");
            // Unlisted relations stay on the shell.
            expect(split?.entities.map((link) => link.entityId)).toEqual([entityB]);
            expect(split?.topics.map((membership) => membership.topicId)).toEqual([topicB]);
            expect(split?.evidence).toEqual([]);
            // User state is never fanned out (ADR-0012 decision 4).
            expect(split?.favorited).toBe(true);
            expect(split?.labels.map((label) => label.name)).toEqual(["分类 A"]);

            const successorA = await repository.story(split!.story.replacedBy[0]!.storyId);
            expect(successorA?.story).toMatchObject({
                kind: "event",
                title: "事件 A",
                summary: "A 的摘要",
                status: "active",
                replacedBy: [],
            });
            expect(successorA?.entries.map((entry) => entry.id)).toEqual(["entry-a"]);
            expect(successorA?.evidence.map((item) => item.entryId)).toEqual(["entry-d"]);
            expect(successorA?.entities.map((link) => link.entityId)).toEqual([entityA]);
            expect(successorA?.topics.map((membership) => membership.topicId)).toEqual([topicA]);
            expect(successorA?.favorited).toBe(false);
            expect(successorA?.labels).toEqual([]);

            const successorB = await repository.story(split!.story.replacedBy[1]!.storyId);
            expect(successorB?.story).toMatchObject({ kind: "document", title: "事件 B", status: "active" });
            expect(successorB?.entries.map((entry) => entry.id)).toEqual(["entry-b"]);
            expect(successorB?.evidence).toEqual([]);
            expect(successorB?.entities).toEqual([]);
            expect(successorB?.topics).toEqual([]);

            // The split is auditable and the successors got their initial Revision.
            const events = await prisma.domainEvent.findMany({
                where: { type: "story.split.v1" },
            });
            expect(events).toHaveLength(1);
            expect(JSON.parse(events[0]!.payloadJson)).toMatchObject({
                storyId: "story-shell",
                actor: "user",
                reason: "两个事件被错误合并",
                successors: [
                    {
                        storyId: successorA!.story.id,
                        entryIds: ["entry-a"],
                        evidenceEntryIds: ["entry-d"],
                        entityIds: [entityA],
                        topicIds: [topicA],
                    },
                    { storyId: successorB!.story.id, entryIds: ["entry-b"] },
                ],
            });
            expect(await prisma.storyRevision.count({
                where: { storyId: successorA!.story.id },
            })).toBe(1);
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("rejects mappings that do not describe the shell's current relations", async () => {
        const { repository, prisma } = await setup();
        try {
            const shell = await seedShell(repository, prisma);
            const entityB = shell.entities[1]!;
            const base = {
                storyId: "story-shell",
                successors: [
                    {
                        title: "A",
                        summary: null,
                        kind: "event" as const,
                        subtype: null,
                        entryIds: ["entry-a"],
                        evidenceEntryIds: [] as string[],
                        entityIds: [] as string[],
                        topicIds: [] as string[],
                    },
                    {
                        title: "B",
                        summary: null,
                        kind: "event" as const,
                        subtype: null,
                        entryIds: ["entry-b"],
                        evidenceEntryIds: [] as string[],
                        entityIds: [] as string[],
                        topicIds: [] as string[],
                    },
                ],
            };

            await expect(repository.splitStory({
                ...base,
                successors: [{ ...base.successors[0]!, entryIds: ["entry-unknown"] }, base.successors[1]!],
            })).rejects.toThrow(StorySplitConflictError);
            await expect(repository.splitStory({
                ...base,
                successors: [{ ...base.successors[0]!, entryIds: ["entry-a"] }, { ...base.successors[1]!, entryIds: ["entry-a"] }],
            })).rejects.toThrow(StorySplitConflictError);
            await expect(repository.splitStory({
                ...base,
                successors: [
                    { ...base.successors[0]!, entryIds: ["entry-a"], evidenceEntryIds: ["entry-a"] },
                    base.successors[1]!,
                ],
            })).rejects.toThrow(StorySplitConflictError);
            await expect(repository.splitStory({
                ...base,
                successors: [
                    { ...base.successors[0]!, entityIds: ["entity-unknown"] },
                    base.successors[1]!,
                ],
            })).rejects.toThrow(StorySplitConflictError);
            await expect(repository.splitStory({
                ...base,
                successors: [
                    { ...base.successors[0]!, topicIds: ["topic-unknown"] },
                    base.successors[1]!,
                ],
            })).rejects.toThrow(StorySplitConflictError);
            await expect(repository.splitStory({
                ...base,
                successors: [{ ...base.successors[0]!, entityIds: [entityB] }],
            })).rejects.toThrow();

            // None of the rejected commands changed anything.
            expect(await prisma.storyReplacement.count()).toBe(0);
            expect((await repository.story("story-shell"))?.story.status).toBe("active");
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("treats a shell as history: no merge, no revision update, no second split", async () => {
        const { repository, prisma } = await setup();
        try {
            const shell = await seedShell(repository, prisma);
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
            });
            const successorA = split!.story.replacedBy[0]!.storyId;

            await expect(repository.mergeStories({
                canonicalStoryId: "story-shell",
                obsoleteStoryIds: [successorA],
            })).rejects.toThrow(StoryMergeConflictError);
            await expect(repository.mergeStories({
                canonicalStoryId: successorA,
                obsoleteStoryIds: ["story-shell"],
            })).rejects.toThrow(StoryMergeConflictError);
            await expect(repository.updateStoryRevision({
                storyId: "story-shell",
                baseRevisionId: split!.story.revisionId,
                title: "改写历史",
                summary: null,
                kind: "event",
                subtype: null,
            })).rejects.toThrow(StoryRevisionConflictError);
            await expect(repository.splitStory({
                storyId: "story-shell",
                successors: [
                    {
                        title: "再拆",
                        summary: null,
                        kind: "event",
                        subtype: null,
                        entryIds: ["entry-c"],
                        evidenceEntryIds: [],
                        entityIds: [],
                        topicIds: [],
                    },
                    {
                        title: "再拆 2",
                        summary: null,
                        kind: "event",
                        subtype: null,
                        entryIds: ["entry-c"],
                        evidenceEntryIds: [],
                        entityIds: [],
                        topicIds: [],
                    },
                ],
            })).rejects.toThrow(StorySplitConflictError);

            // A successor is an ordinary Story. It has a single member here, so
            // it cannot be split further: every successor needs at least one
            // member and the member cannot be assigned twice.
            await expect(repository.splitStory({
                storyId: successorA,
                successors: [
                    {
                        title: "A 的子事件 1",
                        summary: null,
                        kind: "event",
                        subtype: null,
                        entryIds: ["entry-a"],
                        evidenceEntryIds: [],
                        entityIds: [],
                        topicIds: [],
                    },
                    {
                        title: "A 的子事件 2",
                        summary: null,
                        kind: "event",
                        subtype: null,
                        entryIds: ["entry-a"],
                        evidenceEntryIds: [],
                        entityIds: [],
                        topicIds: [],
                    },
                ],
            })).rejects.toThrow(StorySplitConflictError);
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("reads a shell with no member left and upgrades a pre-split database", async () => {
        const root = await mkdtemp(join(tmpdir(), "cosmos-story-split-legacy-"));
        roots.push(root);
        const databasePath = join(root, "cosmos.sqlite");
        const prismaSource = resolve(process.cwd(), "packages/storage-prisma/prisma");
        const oldPrismaRoot = join(root, "old-prisma");
        const oldMigrationsRoot = join(oldPrismaRoot, "migrations");
        await mkdir(oldMigrationsRoot, { recursive: true });
        await cp(join(prismaSource, "schema.prisma"), join(oldPrismaRoot, "schema.prisma"));
        await cp(
            join(prismaSource, "migrations", "migration_lock.toml"),
            join(oldMigrationsRoot, "migration_lock.toml"),
        );
        for (const migration of legacyMigrations) {
            await cp(
                join(prismaSource, "migrations", migration),
                join(oldMigrationsRoot, migration),
                { recursive: true },
            );
        }
        deployMigrations(databasePath, join(oldPrismaRoot, "schema.prisma"));

        const oldClient = new PrismaClient({
            datasources: { db: { url: sqliteUrl(databasePath) } },
        });
        clients.add(oldClient);
        await oldClient.$executeRawUnsafe(`
            INSERT INTO "SourceInstance" ("id", "name", "kind", "sourceDefinitionRef", "operationId", "configJson", "enabled", "revision", "createdAt", "updatedAt")
            VALUES ('source-a', 'source-a', 'rss', 'source.rss@1', 'fetch', '{}', 1, 1, '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z')
        `);
        await oldClient.$executeRawUnsafe(`
            INSERT INTO "Story" ("id", "kind", "subtype", "createdAt", "updatedAt") VALUES
                ('story-shell', 'event', NULL, '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z'),
                ('story-other', 'event', NULL, '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z')
        `);
        await oldClient.$executeRawUnsafe(`
            INSERT INTO "StoryRevision" ("id", "storyId", "revision", "fingerprint", "title", "summary", "createdAt") VALUES
                ('rev-shell-1', 'story-shell', 1, 'fp-shell', '被错误合并的 Story', NULL, '2026-09-09T00:00:00.000Z'),
                ('rev-other-1', 'story-other', 1, 'fp-other', '另一个 Story', NULL, '2026-09-09T00:00:00.000Z')
        `);
        await oldClient.$executeRawUnsafe(`
            UPDATE "Story" SET "currentRevisionId" = 'rev-shell-1' WHERE "id" = 'story-shell';
            UPDATE "Story" SET "currentRevisionId" = 'rev-other-1' WHERE "id" = 'story-other';
        `);
        for (const [entryId, revisionId] of [["entry-a", "er-a-1"], ["entry-b", "er-b-1"]] as const) {
            await oldClient.$executeRawUnsafe(`
                INSERT INTO "Entry" ("id", "sourceInstanceId", "canonicalExternalId", "storyId", "createdAt", "updatedAt")
                VALUES ('${entryId}', 'source-a', 'external:${entryId}', 'story-shell', '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z')
            `);
            await oldClient.$executeRawUnsafe(`
                INSERT INTO "EntryRevision" ("id", "entryId", "revision", "title", "contentText", "contentFingerprint", "contentKind", "createdAt")
                VALUES ('${revisionId}', '${entryId}', 1, '${entryId}', 'body', 'fp-${entryId}', 'article', '2026-09-09T00:00:00.000Z')
            `);
            await oldClient.$executeRawUnsafe(`
                UPDATE "Entry" SET "currentRevisionId" = '${revisionId}' WHERE "id" = '${entryId}';
            `);
        }
        await oldClient.$disconnect();
        clients.delete(oldClient);

        deployMigrations(databasePath, join(prismaSource, "schema.prisma"));
        const prisma = new PrismaClient({
            datasources: { db: { url: sqliteUrl(databasePath) } },
        });
        clients.add(prisma);
        const repository = new PrismaCosmosRepository({ dataRoot: root, prisma });
        await repository.initialize();
        try {
            expect((await repository.story("story-shell"))?.story.status).toBe("active");

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
            });
            // Every member moved, so the shell has no representative entry and
            // stays readable through its current Revision (ADR-0012 decision 2).
            expect(split?.story.status).toBe("split");
            expect(split?.entry).toBeNull();
            expect(split?.entries).toEqual([]);
            expect(split?.story.replacedBy).toHaveLength(2);
            expect(await prisma.storyReplacement.count()).toBe(2);
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
    const root = await mkdtemp(join(tmpdir(), "cosmos-story-split-"));
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

/** A shell with two mapped members plus unlisted evidence/entities/topics. */
async function seedShell(
    repository: PrismaCosmosRepository,
    prisma: PrismaClient,
): Promise<{
    entities: [string, string];
    topics: [string, string];
}> {
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
        ["story-other", "另一个 Story"],
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
    for (const [entryId, storyId] of [
        ["entry-a", "story-shell"],
        ["entry-b", "story-shell"],
        ["entry-c", "story-shell"],
        ["entry-d", "story-other"],
    ] as const) {
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
            data: { storyId, currentRevisionId: `er-${entryId}` },
        });
    }

    // entry-d is a non-member of the shell, so the link is not a self-link.
    await repository.linkEntryStory({
        entryId: "entry-d",
        storyId: "story-shell",
        relationType: "evidence_for",
        reason: "背景",
    });
    const entityA = (await repository.createEntity({ name: "Entity A", type: "person" }))!.entity;
    const entityB = (await repository.createEntity({ name: "Entity B", type: "organization" }))!.entity;
    await repository.linkStoryEntity({ storyId: "story-shell", entityId: entityA.id });
    await repository.linkStoryEntity({ storyId: "story-shell", entityId: entityB.id });
    const topicA = (await repository.createTopic({
        title: "Topic A",
        purpose: "Purpose A",
        scope: null,
    }))!.topic;
    const topicB = (await repository.createTopic({
        title: "Topic B",
        purpose: "Purpose B",
        scope: null,
    }))!.topic;
    await repository.addTopicMember({ topicId: topicA.id, storyId: "story-shell", role: "core" });
    await repository.addTopicMember({ topicId: topicB.id, storyId: "story-shell", role: "update" });
    const label = await repository.createLabel({ name: "分类 A" });
    await repository.attachLabel({ labelId: label.id, targetType: "story", targetId: "story-shell" });
    await repository.setFavorite({ targetType: "story", targetId: "story-shell" });
    return { entities: [entityA.id, entityB.id], topics: [topicA.id, topicB.id] };
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
