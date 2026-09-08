import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { PrismaClient } from "@prisma/client";
import {
    EntityNotFoundError,
    EntityRelationConflictError,
    EntityRevisionConflictError,
    StoryNotFoundError,
} from "@cosmos/application";
import { afterEach, describe, expect, it } from "vitest";

import { PrismaCosmosRepository } from "./index.js";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Entity domain commands", () => {
    it("creates an entity with an alias and versions identity revisions", async () => {
        const { repository, prisma } = await setup();
        try {
            const created = await repository.createEntity({
                name: "Jeff Dean",
                type: "person",
                alias: "Jeffrey Dean",
                actor: "user",
                reason: "关注人物",
            });
            expect(created?.entity.name).toBe("Jeff Dean");
            expect(created?.entity.type).toBe("person");
            expect(created?.aliases).toEqual(["Jeffrey Dean"]);

            const entityId = created!.entity.id;
            const updated = await repository.updateEntity({
                entityId,
                baseRevisionId: created!.entity.revisionId,
                name: "Jeff Dean（AI 研究）",
                type: "person",
                actor: "user",
                reason: "规范名补全",
            });
            expect(updated?.entity.revisionId).not.toBe(created?.entity.revisionId);
            expect(updated?.entity.name).toBe("Jeff Dean（AI 研究）");

            const noOp = await repository.updateEntity({
                entityId,
                baseRevisionId: updated!.entity.revisionId,
                name: "Jeff Dean（AI 研究）",
                type: "person",
            });
            expect(noOp?.entity.revisionId).toBe(updated?.entity.revisionId);

            await expect(repository.updateEntity({
                entityId,
                baseRevisionId: created!.entity.revisionId,
                name: "Stale",
                type: "person",
            })).rejects.toBeInstanceOf(EntityRevisionConflictError);

            await repository.addEntityAlias({
                entityId,
                name: "JD",
            });
            const withAlias = await repository.entity(entityId);
            expect(withAlias?.aliases).toContain("JD");
            await repository.removeEntityAlias({ entityId, name: "JD" });
            expect((await repository.entity(entityId))?.aliases).not.toContain("JD");

            await expect(repository.updateEntity({
                entityId: "entity-missing",
                baseRevisionId: "x",
                name: "X",
                type: "person",
            })).rejects.toBeInstanceOf(EntityNotFoundError);
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("links and unlinks a story with idempotent provenance and reflects on Story detail", async () => {
        const { repository, prisma } = await setup();
        try {
            const entity = await repository.createEntity({
                name: "Jeff Dean",
                type: "person",
            });
            const entityId = entity!.entity.id;

            const linked = await repository.linkStoryEntity({
                storyId: "story-a",
                entityId,
                producer: "human",
                confidence: 0.95,
                evidence: "离职报道主角",
                actor: "user",
                reason: "报道主角",
            });
            expect(linked?.stories).toEqual([
                expect.objectContaining({
                    storyId: "story-a",
                    producer: "human",
                    confidence: 0.95,
                }),
            ]);

            // Idempotent re-link keeps a single StoryEntity row.
            await repository.linkStoryEntity({ storyId: "story-a", entityId });
            const story = await repository.story("story-a");
            expect(story?.entities).toHaveLength(1);
            expect(story?.entities[0]).toEqual(expect.objectContaining({
                entityId,
                name: "Jeff Dean",
                type: "person",
                producer: "human",
            }));

            await repository.linkStoryEntity({
                storyId: "story-b",
                entityId,
            });
            expect((await repository.entity(entityId))?.stories).toHaveLength(2);

            await repository.unlinkStoryEntity({
                storyId: "story-a",
                entityId,
                actor: "user",
                reason: "取消关联",
            });
            expect((await repository.entity(entityId))?.stories.map((s) => s.storyId))
                .toEqual(["story-b"]);

            await expect(repository.linkStoryEntity({
                storyId: "story-missing",
                entityId,
            })).rejects.toBeInstanceOf(StoryNotFoundError);
            await expect(repository.linkStoryEntity({
                storyId: "story-a",
                entityId: "entity-missing",
            })).rejects.toBeInstanceOf(EntityNotFoundError);
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("creates typed relations with provenance and validates distinct endpoints", async () => {
        const { repository, prisma } = await setup();
        try {
            const jeff = await repository.createEntity({ name: "Jeff Dean", type: "person" });
            const loop = await repository.createEntity({ name: "Discovery Loop", type: "organization" });
            const google = await repository.createEntity({ name: "Google", type: "organization" });
            const jeffId = jeff!.entity.id;
            const loopId = loop!.entity.id;
            const googleId = google!.entity.id;

            const relation = await repository.createEntityRelation({
                fromEntityId: jeffId,
                toEntityId: loopId,
                relationType: "founded",
                confidence: 0.9,
                evidence: "官方公告",
                actor: "user",
                reason: "已知履历",
            });
            const fromJeff = await repository.entity(jeffId);
            expect(fromJeff?.relations).toEqual([
                expect.objectContaining({
                    fromEntityId: jeffId,
                    toEntityId: loopId,
                    relationType: "founded",
                    confidence: 0.9,
                }),
            ]);

            // The same directed relation is idempotent; the reverse direction is a distinct row.
            await repository.createEntityRelation({
                fromEntityId: jeffId,
                toEntityId: loopId,
                relationType: "founded",
            });
            await repository.createEntityRelation({
                fromEntityId: jeffId,
                toEntityId: googleId,
                relationType: "works_at",
            });
            // A relation visible from its target side too.
            const onGoogle = await repository.entity(googleId);
            expect(onGoogle?.relations).toContainEqual(expect.objectContaining({
                fromEntityId: jeffId,
                toEntityId: googleId,
                relationType: "works_at",
            }));

            await expect(repository.createEntityRelation({
                fromEntityId: jeffId,
                toEntityId: jeffId,
                relationType: "related_to",
            })).rejects.toBeInstanceOf(EntityRelationConflictError);
            await expect(repository.createEntityRelation({
                fromEntityId: jeffId,
                toEntityId: "entity-missing",
                relationType: "related_to",
            })).rejects.toBeInstanceOf(EntityNotFoundError);
            await expect(repository.createEntityRelation({
                fromEntityId: jeffId,
                toEntityId: loopId,
                // @ts-expect-error storage rejects unknown relation types before any write
                relationType: "mentored",
            })).rejects.toBeInstanceOf(EntityRelationConflictError);

            await repository.removeEntityRelation({
                fromEntityId: jeffId,
                toEntityId: googleId,
                relationType: "works_at",
                actor: "user",
                reason: "关系过时",
            });
            expect((await repository.entity(jeffId))?.relations.some((r) => {
                return r.toEntityId === googleId && r.relationType === "works_at";
            })).toBe(false);
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("migrates Story↔Entity links when Stories are merged (move and collision)", async () => {
        const { repository, prisma } = await setup();
        try {
            const jeff = await repository.createEntity({ name: "Jeff Dean", type: "person" });
            const entityId = jeff!.entity.id;

            // Move path: only story-b is linked; merging story-b into story-a moves it.
            await repository.linkStoryEntity({ storyId: "story-b", entityId });
            await repository.mergeStories({
                canonicalStoryId: "story-a",
                obsoleteStoryIds: ["story-b"],
            });
            const storyAfterMove = await repository.story("story-a");
            expect(storyAfterMove?.entities.map((e) => e.entityId)).toEqual([entityId]);
            expect((await repository.entity(entityId))?.stories.map((s) => s.storyId))
                .toEqual(["story-a"]);

            // Collision path: both canonical and obsolete link the same entity;
            // merging collapses to one row on the canonical story.
            await repository.linkStoryEntity({ storyId: "story-a", entityId });
            await repository.linkStoryEntity({ storyId: "story-c", entityId });
            await repository.mergeStories({
                canonicalStoryId: "story-a",
                obsoleteStoryIds: ["story-c"],
            });
            const afterCollision = await repository.story("story-a");
            expect(afterCollision?.entities).toHaveLength(1);
            expect(afterCollision?.entities[0].entityId).toBe(entityId);
            const links = await prisma.storyEntity.findMany({ where: { entityId } });
            expect(links.map((link) => link.storyId)).toEqual(["story-a"]);

            const events = await repository.events({ afterSequence: 0, limit: 50 });
            expect(events.some((event) => event.type === "story_entity.merged.v1")).toBe(true);
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("lists entities with link and relation counts", async () => {
        const { repository, prisma } = await setup();
        try {
            const jeff = await repository.createEntity({ name: "Jeff Dean", type: "person" });
            const loop = await repository.createEntity({ name: "Discovery Loop", type: "organization" });
            const jeffId = jeff!.entity.id;
            const loopId = loop!.entity.id;
            await repository.linkStoryEntity({ storyId: "story-a", entityId: jeffId });
            await repository.createEntityRelation({
                fromEntityId: jeffId,
                toEntityId: loopId,
                relationType: "founded",
            });

            const page = await repository.listEntities({ limit: 10 });
            expect(page.items).toHaveLength(2);
            const jeffSummary = page.items.find((item) => item.id === jeffId)!;
            expect(jeffSummary.storyCount).toBe(1);
            expect(jeffSummary.relationCount).toBe(1);
            const loopSummary = page.items.find((item) => item.id === loopId)!;
            expect(loopSummary.storyCount).toBe(0);
            expect(loopSummary.relationCount).toBe(1);
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
    const root = await mkdtemp(join(tmpdir(), "cosmos-entity-relation-"));
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
