import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { ContentCommands, IngestionService, type IngestConnector } from "@cosmos/application";
import { createFixtureSource, withRepository } from "./index.fixtures.js";
import { selectContentRepresentation } from "./repository/representation-selection.js";
import { PrismaContentSelectionRepository } from "./repository/content-commands.js";

it("keeps locked selections, rejects stale and foreign targets, and audits explicit rollback", async () => {
    await withRepository("representation-selection", async (repository, prisma) => {
        const source = await createFixtureSource(repository, { name: "Selection fixture", config: {} });
        const connector: IngestConnector = {
            id: "test-fixture", description: "Selection fixture", configVersion: "v1",
            capabilities: ["test"], validate: () => undefined,
            async fetchItems() {
                return { items: ["a", "b"].map((externalId) => ({
                    externalId, title: externalId, summary: null, contentText: "body", webUrl: null,
                    kind: "article" as const, publisher: null, metrics: null, publishedAt: null,
                    updatedAt: null, sourceLocator: { provider: "fixture", item: externalId },
                    rawPayload: "fixture", assets: [],
                })), nextCursor: null };
            },
        };
        await new IngestionService(repository, () => connector).runSource(source.id);
        const revisions = await prisma.entryRevision.findMany({ include: { currentRepresentation: true } });
        const revision = revisions[0];
        const original = revision.currentRepresentation!;
        const replacement = await prisma.contentRepresentation.create({
            data: {
                ...original, id: randomUUID(), representationVersion: 2,
                supersedesRepresentationId: original.id,
            },
        });
        const input = {
            entryRevisionId: revision.id, representationId: replacement.id,
            expectedCurrentId: original.id, mode: "automatic" as const,
            systemRecommended: true, actorId: "system",
        };
        const select = (value: Parameters<typeof selectContentRepresentation>[1]) =>
            prisma.$transaction((tx) => selectContentRepresentation(tx, value));
        await expect(select({ ...input, representationId: revisions[1].currentRepresentationId! }))
            .rejects.toThrow("belongs to another source revision");
        expect(await select(input)).toBe(true);
        await expect(select(input)).rejects.toThrow("selection conflict");
        expect(await select({
            ...input, mode: "rollback", actorId: "fixture-user",
            expectedCurrentId: replacement.id, representationId: original.id,
        })).toBe(true);
        expect(await select(input)).toBe(false);
        const selected = await prisma.entryRevision.findUniqueOrThrow({ where: { id: revision.id } });
        expect(selected.currentRepresentationId).toBe(original.id);
        expect(selected.representationLocked).toBe(true);
        expect(await prisma.contentRepresentation.count({ where: { entryRevisionId: revision.id } })).toBe(2);
        const events = await prisma.domainEvent.findMany({ where: { type: "content.representation.selected" } });
        expect(events).toHaveLength(2);
        expect(JSON.parse(events[1].payloadJson)).toMatchObject({ actorId: "fixture-user", mode: "rollback" });

        const port = new PrismaContentSelectionRepository(prisma);
        const commands = new ContentCommands(port);
        const authority = { actorId: "human-fixture", canManageRepresentations: true };
        const unlock = { entryRevisionId: revision.id, expectedCurrentId: original.id, expectedLocked: true, operation: "unlock" as const };
        expect(await commands.select(unlock, authority)).toMatchObject({ locked: false, changed: true });
        await expect(commands.select(unlock, authority)).rejects.toMatchObject({ code: "conflict" });
        const lock = { ...unlock, expectedLocked: false, operation: "lock" as const };
        const captured = await port.readSelection(lock);
        await prisma.entryRevision.update({ where: { id: revision.id }, data: { currentRepresentationId: replacement.id } });
        await expect(port.commitSelection({ command: lock, actorId: authority.actorId, currentRepresentationId: captured!.currentRepresentationId, locked: true }))
            .rejects.toMatchObject({ code: "conflict" });
        expect(await prisma.domainEvent.count({ where: { type: "content.representation.selected" } })).toBe(3);
        const rollback = { ...lock, expectedCurrentId: replacement.id, operation: "rollback" as const, representationId: original.id };
        expect(await commands.select(rollback, authority)).toMatchObject({ currentRepresentationId: original.id, locked: true });
        expect(await commands.select({ ...rollback, expectedCurrentId: original.id, expectedLocked: true }, authority)).toMatchObject({ changed: false });
        expect(await prisma.domainEvent.count({ where: { type: "content.representation.selected" } })).toBe(4);
        expect(await prisma.contentRepresentation.count({ where: { entryRevisionId: revision.id } })).toBe(2);
    });
});
