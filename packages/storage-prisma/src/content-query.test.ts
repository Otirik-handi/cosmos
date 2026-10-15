import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { ContentQuery, IngestionService, type IngestConnector } from "@cosmos/application";
import { createFixtureSource, withRepository } from "./index.fixtures.js";
import { PrismaContentQueryRepository } from "./repository/content-query.js";

it("reads the selected pointer and exact history without exposing stored evidence or substituting missing versions", async () => {
    await withRepository("content-query", async (repository, prisma) => {
        const source = await createFixtureSource(repository, { name: "Content query fixture", config: {} });
        const connector: IngestConnector = {
            id: "test-fixture", description: "Content query fixture", configVersion: "v1",
            capabilities: ["test"], validate: () => undefined,
            async fetchItems() {
                return { items: [{
                    externalId: "one", title: "Fixture", summary: null, contentText: "fallback", webUrl: null,
                    kind: "article", publisher: null, metrics: null, publishedAt: null, updatedAt: null,
                    sourceLocator: { provider: "fixture", item: "one" }, rawPayload: "private evidence", assets: [],
                    contentSource: { format: "plain-text", text: "Original body" },
                }], nextCursor: null };
            },
        };
        await new IngestionService(repository, () => connector).runSource(source.id);
        const revision = await prisma.entryRevision.findFirstOrThrow({ include: { currentRepresentation: true } });
        const original = revision.currentRepresentation!;
        const replacement = await prisma.contentRepresentation.create({ data: {
            ...original, id: randomUUID(), representationVersion: 2,
            contentText: "Replacement body", supersedesRepresentationId: original.id,
        } });
        await prisma.entryRevision.update({ where: { id: revision.id }, data: { currentRepresentationId: replacement.id } });
        const query = new ContentQuery(new PrismaContentQueryRepository(prisma));
        const authority = { allowedProfiles: ["structured-content"] as const };
        const current = await query.structuredContent({ entryRevisionId: revision.id }, authority);
        expect(current).toMatchObject({ contentText: "Replacement body", readingMode: "representation", evidenceStatus: "available" });
        expect(current?.representation?.representationVersion).toBe(2);
        expect(JSON.stringify(current)).not.toContain("private evidence");
        expect(JSON.stringify(current)).not.toContain("payloadBlobKey");
        expect(await query.structuredContent({ entryRevisionId: revision.id, representationVersion: 1 }, authority))
            .toMatchObject({ contentText: "Original body", representation: { id: original.id } });
        expect(await query.structuredContent({ entryRevisionId: revision.id, representationVersion: 3 }, authority))
            .toMatchObject({ readingMode: "unavailable", contentText: "" });
        await prisma.contentRepresentation.update({ where: { id: replacement.id }, data: { blocksJson: "broken JSON" } });
        expect(await query.structuredContent({ entryRevisionId: revision.id }, authority))
            .toMatchObject({ readingMode: "unavailable", contentText: "" });
        expect(await query.structuredContent({ entryRevisionId: "missing" }, authority)).toBeNull();
    });
});
