import { mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { createMediaAcquirer, IngestionService, mediaDownloadCapability, type IngestConnector } from "@cosmos/application";
import type { NormalizedIngestItem } from "@cosmos/domain";
import { PrismaCosmosRepository, resolveStorageRoots } from "./index.js";
import { createFixtureSource, prepareDatabase, temporaryRoots } from "./index.fixtures.js";

    it("anchors relative data roots to the workspace root", () => {
        const workspaceRoot = resolve(tmpdir(), "cosmos-workspace-root");
        const roots = resolveStorageRoots(".cosmos", workspaceRoot);

        expect(roots.dataRoot).toBe(join(workspaceRoot, ".cosmos"));
        expect(roots.databasePath).toBe(join(
            workspaceRoot,
            ".cosmos",
            "cosmos.sqlite",
        ));
    });

    it("persists observations, revisions, assets, Story projections and FTS results", async () => {
        const root = await mkdtemp(join(tmpdir(), "cosmos-storage-test-"));
        temporaryRoots.push(root);
        prepareDatabase(root);

        const repository = new PrismaCosmosRepository({ dataRoot: root });
        await repository.initialize();

        try {
            const source = await createFixtureSource(repository, {
                name: "Test fixture",
                config: {},
            });
            const pages: readonly NormalizedIngestItem[] = [
            {
                externalId: "stable-1",
                title: "Original title",
                summary: "Summary",
                contentText: "Original body",
                webUrl: null,
                kind: "article",
                publisher: null,
                metrics: null,
                publishedAt: {
                    exact: "2026-08-08T00:00:00.000Z",
                    exactPrecision: "second",
                    fallback: null,
                },
                updatedAt: null,
                sourceLocator: { provider: "fixture", item: "stable-1" },
                rawPayload: "<item>original</item>",
                assets: [{
                    kind: "image",
                    sourceUrl: "https://example.test/image.png",
                    status: "saved",
                    mimeType: "image/png",
                    byteSize: 5,
                    content: new TextEncoder().encode("image"),
                }, {
                    kind: "image",
                    sourceUrl: "https://example.test/broken.png",
                    status: "failed",
                    mimeType: null,
                    byteSize: null,
                    content: null,
                    errorMessage: "图片下载超时",
                }],
            },
            {
                title: "URL-free title",
                summary: null,
                contentText: "URL-free body",
                webUrl: null,
                kind: "article",
                publisher: null,
                metrics: null,
                publishedAt: null,
                updatedAt: null,
                sourceLocator: { provider: "fixture", item: "url-free" },
                rawPayload: "<item>url-free</item>",
                assets: [{
                    kind: "attachment",
                    sourceUrl: null,
                    status: "metadata_only",
                    mimeType: "application/octet-stream",
                    byteSize: null,
                    content: null,
                }],
            },
            ];
            let pageIndex = 0;
            const connector: IngestConnector = {
            id: "test-fixture",
            description: "Test fixture",
            configVersion: "v1",
            capabilities: ["test"],
            validate: () => undefined,
            async fetchItems() {
                const revised = pageIndex++ > 0
                    ? pages.map((item) => item.externalId === "stable-1"
                        ? { ...item, contentText: "Revised body", rawPayload: "<item>revised</item>" }
                        : item)
                    : pages;
                return {
                    items: revised,
                    nextCursor: String(pageIndex),
                };
            },
            };
            const service = new IngestionService(repository, () => connector);

            const first = await service.runSource(source.id);
            const second = await service.runSource(source.id);

            expect(first.createdEntryCount).toBe(2);
            expect(first.revisedEntryCount).toBe(0);
            expect(second.createdEntryCount).toBe(0);
            expect(second.revisedEntryCount).toBe(1);
            expect(second.duplicateObservationCount).toBe(1);

            const feed = await repository.feed({ limit: 20 });
            expect(feed.items).toHaveLength(2);

            const entries = await repository.entries({
                sourceId: source.id,
                limit: 20,
            });
            expect(entries.items).toHaveLength(2);
            expect(entries.items.some((item) => item.revisionCount === 2)).toBe(true);
            expect(entries.items.every((item) => item.observationCount >= 2)).toBe(true);

            const search = await repository.search({
                text: "Revised",
                limit: 20,
            });
            expect(search.items).toHaveLength(1);

            const filtered = await repository.search({
                sourceId: source.id,
                publishedAfter: "2026-08-08T00:00:00.000Z",
                publishedBefore: "2026-08-08T23:59:59.999Z",
                limit: 1,
            });
            expect(filtered.items).toHaveLength(1);
            expect(filtered.nextCursor).toBeNull();

            const firstPage = await repository.search({
                sourceId: source.id,
                limit: 1,
            });
            expect(firstPage.nextCursor).toBe("1");
            const secondPage = await repository.search({
                sourceId: source.id,
                cursor: firstPage.nextCursor ?? undefined,
                limit: 1,
            });
            expect(secondPage.items).toHaveLength(1);
            expect(secondPage.nextCursor).toBeNull();

            const stories = await Promise.all(
                feed.items.map((item) => repository.story(item.storyId)),
            );
            const revisedStory = stories.find((item) => item?.entry?.revisions.length === 2);
            expect(revisedStory?.entry?.observations.length).toBe(2);

            const savedAsset = stories
                .flatMap((story) => story?.entry?.revisions ?? [])
                .flatMap((revision) => revision.assets)
                .find((asset) => asset.status === "saved");
            expect(savedAsset).toBeDefined();
            const asset = await repository.readAsset(savedAsset!.id);
            expect(new TextDecoder().decode(asset!.content)).toBe("image");

            const failedAsset = stories
                .flatMap((story) => story?.entry?.revisions ?? [])
                .flatMap((revision) => revision.assets)
                .find((entry) => entry.status === "failed");
            expect(failedAsset).toMatchObject({
                status: "failed",
                storageKey: null,
                errorMessage: "图片下载超时",
            });

            expect(revisedStory).toBeDefined();
            const storyRevisions = await repository.prisma.storyRevision.findMany({
                where: { storyId: revisedStory!.story.id },
                orderBy: { revision: "asc" },
            });
            // Content revision without display-field change must not append a StoryRevision (ADR-0006).
            expect(storyRevisions.map((revision) => revision.revision)).toEqual([1]);
            expect(storyRevisions[0].fingerprint).toHaveLength(64);
        } finally {
            await repository.close();
        }
    });

    it("preflights unchanged items and skips media re-download on legacy runs", async () => {
        const root = await mkdtemp(join(tmpdir(), "cosmos-media-skip-legacy-test-"));
        temporaryRoots.push(root);
        prepareDatabase(root);

        const repository = new PrismaCosmosRepository({ dataRoot: root });
        await repository.initialize();

        try {
            const source = await createFixtureSource(repository, {
                name: "Media skip fixture",
                config: {},
            });
            const otherSource = await createFixtureSource(repository, {
                name: "Other media skip fixture",
                config: {},
            });
            const item: NormalizedIngestItem = {
                externalId: "media-skip-1",
                title: "Media skip item",
                summary: null,
                contentText: "Unchanged media body",
                webUrl: "https://example.test/media-skip",
                kind: "article",
                publisher: null,
                metrics: null,
                publishedAt: null,
                updatedAt: null,
                sourceLocator: { provider: "fixture", item: "media-skip-1" },
                rawPayload: "<item>media-skip</item>",
                assets: [{
                    kind: "image",
                    sourceUrl: "https://media.example.test/a.png",
                    status: "metadata_only",
                    mimeType: null,
                    byteSize: null,
                    content: null,
                }],
            };
            const fetched: string[] = [];
            const connector: IngestConnector = {
                id: "rss",
                description: "Media skip connector",
                configVersion: "v1",
                capabilities: [mediaDownloadCapability],
                validate: () => undefined,
                fetchItems: async () => ({
                    items: [item],
                    nextCursor: null,
                }),
            };
            const mediaAcquirer = createMediaAcquirer({
                fetch: async (input) => {
                    fetched.push(String(input));
                    return new Response(
                        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
                        { status: 200, headers: { "content-type": "image/png" } },
                    );
                },
                resolveHost: async () => ["93.184.216.34"],
            });
            const service = new IngestionService(
                repository,
                () => connector,
                undefined,
                mediaAcquirer,
            );

            const first = await service.runSource(source.id);
            const unchanged = await repository.listContentUnchangedItems({
                sourceId: source.id,
                items: [item],
            });
            const otherSourceUnchanged = await repository.listContentUnchangedItems({
                sourceId: otherSource.id,
                items: [item],
            });
            const changedItem: NormalizedIngestItem = {
                ...item,
                contentText: "Revised media body",
                rawPayload: "<item>media-skip-revised</item>",
            };
            const revisedUnchanged = await repository.listContentUnchangedItems({
                sourceId: source.id,
                items: [changedItem],
            });
            const second = await service.runSource(source.id);

            expect(first.createdEntryCount).toBe(1);
            expect(second.duplicateObservationCount).toBe(1);
            expect(unchanged).toEqual([true]);
            expect(otherSourceUnchanged).toEqual([false]);
            expect(revisedUnchanged).toEqual([false]);
            expect(fetched).toHaveLength(1);
        } finally {
            await repository.close();
        }
    });

