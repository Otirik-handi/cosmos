import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";

import { PrismaCosmosRepository } from "./index.js";
import { resolvePrismaCliPath } from "./prisma-cli.js";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/**
 * ADR-0021 decision 4: a Story Revision written before the representation
 * extension exists stored this digest. It is recomputed here from the legacy
 * algorithm instead of importing the domain fingerprint, so this guard stays
 * independent of the implementation it protects (packages/domain pins the same
 * digests in its own test).
 */
function preExtensionFingerprint(input: {
    title: string;
    summary: string | null;
    kind: string;
    subtype: string | null;
}): string {
    return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

async function createRepository(): Promise<{
    prisma: PrismaClient;
    repository: PrismaCosmosRepository;
}> {
    const root = await mkdtemp(join(tmpdir(), "cosmos-story-representation-"));
    roots.push(root);
    const databasePath = join(root, "cosmos.sqlite");
    deployMigrations(databasePath);
    const prisma = new PrismaClient({
        datasources: { db: { url: sqliteUrl(databasePath) } },
    });
    const repository = new PrismaCosmosRepository({ dataRoot: root, prisma });
    await repository.initialize();
    return { prisma, repository };
}

async function seedLegacyStory(prisma: PrismaClient): Promise<void> {
    const title = "Legacy event title";
    await prisma.story.create({ data: { id: "story-legacy", kind: "event" } });
    await prisma.storyRevision.create({
        data: {
            id: "rev-legacy-1",
            storyId: "story-legacy",
            revision: 1,
            fingerprint: preExtensionFingerprint({
                title,
                summary: null,
                kind: "event",
                subtype: null,
            }),
            title,
            summary: null,
        },
    });
    await prisma.story.update({
        where: { id: "story-legacy" },
        data: { currentRevisionId: "rev-legacy-1" },
    });
}

describe("Story representation extension persistence", () => {
    it("treats a pre-extension Revision as unchanged instead of appending a phantom version", async () => {
        const { prisma, repository } = await createRepository();
        try {
            await seedLegacyStory(prisma);

            const noOp = await repository.updateStoryRevision({
                storyId: "story-legacy",
                baseRevisionId: "rev-legacy-1",
                title: "Legacy event title",
                summary: null,
                kind: "event",
                subtype: null,
            });

            expect(noOp?.story.revisionId).toBe("rev-legacy-1");
            expect(await prisma.storyRevision.count({ where: { storyId: "story-legacy" } })).toBe(1);
            expect(noOp?.story.timeRange ?? null).toBeNull();
            expect(noOp?.story.keyFacts ?? []).toEqual([]);
        } finally {
            await prisma.$disconnect();
        }
    });

    it("appends one Revision per real change, keeps identical submissions as no-ops and clears on omission", async () => {
        const { prisma, repository } = await createRepository();
        try {
            await seedLegacyStory(prisma);
            const timeRange = {
                start: {
                    exact: "2026-09-14T09:30:00.000Z",
                    exactPrecision: "second" as const,
                    fallback: null,
                },
                end: null,
            };
            const keyFacts = [
                { text: "上下文窗口 1M", entryId: null },
                { text: "对标 GPT-5", entryId: "entry-1" },
            ];

            const changed = await repository.updateStoryRevision({
                storyId: "story-legacy",
                baseRevisionId: "rev-legacy-1",
                title: "Legacy event title",
                summary: null,
                kind: "event",
                subtype: null,
                timeRange,
                keyFacts,
                actor: "user",
                reason: "add representation",
            });
            expect(changed?.story.revisionId).not.toBe("rev-legacy-1");
            expect(changed?.story.timeRange).toEqual(timeRange);
            expect(changed?.story.keyFacts).toEqual(keyFacts);
            const stored = await prisma.storyRevision.findUniqueOrThrow({
                where: { id: changed!.story.revisionId },
                select: { timeRangeJson: true, keyFactsJson: true },
            });
            expect(stored.timeRangeJson).not.toBeNull();
            expect(stored.keyFactsJson).not.toBeNull();

            const repeated = await repository.updateStoryRevision({
                storyId: "story-legacy",
                baseRevisionId: changed!.story.revisionId,
                title: "Legacy event title",
                summary: null,
                kind: "event",
                subtype: null,
                timeRange,
                keyFacts,
            });
            expect(repeated?.story.revisionId).toBe(changed?.story.revisionId);
            expect(await prisma.storyRevision.count({ where: { storyId: "story-legacy" } })).toBe(2);

            const cleared = await repository.updateStoryRevision({
                storyId: "story-legacy",
                baseRevisionId: repeated!.story.revisionId,
                title: "Legacy event title",
                summary: null,
                kind: "event",
                subtype: null,
            });
            expect(cleared?.story.revisionId).not.toBe(repeated?.story.revisionId);
            expect(cleared?.story.timeRange ?? null).toBeNull();
            expect(cleared?.story.keyFacts ?? []).toEqual([]);
            const clearedRow = await prisma.storyRevision.findUniqueOrThrow({
                where: { id: cleared!.story.revisionId },
                select: { timeRangeJson: true, keyFactsJson: true },
            });
            expect(clearedRow.timeRangeJson).toBeNull();
            expect(clearedRow.keyFactsJson).toBeNull();
        } finally {
            await prisma.$disconnect();
        }
    });
});

function deployMigrations(databasePath: string): void {
    execFileSync(process.execPath, [
        resolvePrismaCliPath(),
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
