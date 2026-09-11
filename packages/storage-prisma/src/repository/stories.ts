import { randomUUID } from "node:crypto";
import { type StoryDetail } from "@cosmos/contracts";
import { fingerprintStoryRevision, listStorySubtypes as listRegisteredStorySubtypes, type StoryKind, type StorySubtypeRegistration } from "@cosmos/domain";
import { StoryNotFoundError, StoryRevisionConflictError, StorySplitConflictError } from "@cosmos/application";
import { appendDomainEvent, assertStorySubtype } from "./repository-internals.js";
import { PrismaCosmosRepositorySearch } from "./search.js";

export class PrismaCosmosRepositoryStories extends PrismaCosmosRepositorySearch {
    async moveEntryToStory(input: {
        entryId: string;
        storyId: string;
        actor?: string | null;
        reason?: string | null;
    }): Promise<StoryDetail | null> {
        const canonicalStoryId = await this.resolveCanonicalStoryId(input.storyId);
        if (!canonicalStoryId) {
            throw new StoryNotFoundError(input.storyId);
        }
        const entry = await this.prisma.entry.findUnique({
            where: { id: input.entryId },
            select: { id: true, storyId: true },
        });
        if (!entry) {
            return null;
        }
        if (entry.storyId === canonicalStoryId) {
            return this.story(canonicalStoryId);
        }
        await this.prisma.$transaction(async (tx) => {
            await tx.entry.update({
                where: { id: entry.id },
                data: { storyId: canonicalStoryId },
            });
            // Changing the primary Story can make an auxiliary link redundant:
            // an Entry never keeps a link to its own primary Story
            // (ADR-0011 decision 4).
            const removedLinks = await tx.entryStoryLink.deleteMany({
                where: { entryId: entry.id, storyId: canonicalStoryId },
            });
            if (removedLinks.count > 0) {
                await appendDomainEvent(tx, {
                    type: "entry.story_unlinked.v1",
                    aggregateType: "Entry",
                    aggregateId: entry.id,
                    payload: {
                        entryId: entry.id,
                        storyId: canonicalStoryId,
                        actor: input.actor ?? null,
                        reason: input.reason ?? null,
                        cause: "primary_story_changed",
                    },
                });
            }
            await appendDomainEvent(tx, {
                type: "story.entry_moved.v1",
                aggregateType: "Story",
                aggregateId: canonicalStoryId,
                payload: {
                    entryId: entry.id,
                    fromStoryId: entry.storyId ?? null,
                    toStoryId: canonicalStoryId,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
        });
        return this.story(canonicalStoryId);
    }

    async updateStoryRevision(input: {
        storyId: string;
        baseRevisionId: string;
        title: string;
        summary: string | null;
        kind: "event" | "document" | "media" | "thread";
        subtype: string | null;
        actor?: string | null;
        reason?: string | null;
    }): Promise<StoryDetail | null> {
        const canonicalStoryId = await this.resolveCanonicalStoryId(input.storyId);
        if (!canonicalStoryId) {
            throw new StoryNotFoundError(input.storyId);
        }
        if (await this.isStoryShell(canonicalStoryId)) {
            throw new StoryRevisionConflictError(canonicalStoryId);
        }
        const story = await this.prisma.story.findUnique({
            where: { id: canonicalStoryId },
            include: { currentRevision: true },
        });
        if (!story) {
            throw new StoryNotFoundError(input.storyId);
        }
        if (!story.currentRevision || story.currentRevision.id !== input.baseRevisionId) {
            throw new StoryRevisionConflictError(input.storyId);
        }
        // A subtype already stored on this Story may be unregistered (legacy
        // data); editing other fields keeps it. Any other value is a new
        // assignment and must be a writable registration (ORG-013).
        if (input.kind !== story.kind || input.subtype !== story.subtype) {
            assertStorySubtype(input.kind, input.subtype);
        }
        const fingerprint = fingerprintStoryRevision({
            title: input.title,
            summary: input.summary,
            kind: input.kind,
            subtype: input.subtype,
        });
        if (story.currentRevision.fingerprint === fingerprint) {
            return this.story(canonicalStoryId);
        }
        await this.prisma.$transaction(async (tx) => {
            const latest = await tx.storyRevision.findFirst({
                where: { storyId: canonicalStoryId },
                orderBy: { revision: "desc" },
                select: { revision: true },
            });
            const created = await tx.storyRevision.create({
                data: {
                    story: { connect: { id: canonicalStoryId } },
                    revision: (latest?.revision ?? 0) + 1,
                    fingerprint,
                    actorJson: input.actor == null ? null : JSON.stringify(input.actor),
                    reason: input.reason ?? null,
                    title: input.title,
                    summary: input.summary,
                },
            });
            await tx.story.update({
                where: { id: canonicalStoryId },
                data: {
                    currentRevisionId: created.id,
                    // kind/subtype are Story display fields (ADR-0006 decision 3);
                    // before ORG-013 they were fingerprinted but never persisted.
                    kind: input.kind,
                    subtype: input.subtype,
                },
            });
            await appendDomainEvent(tx, {
                type: "story.revision_created.v1",
                aggregateType: "Story",
                aggregateId: canonicalStoryId,
                payload: {
                    storyId: canonicalStoryId,
                    baseRevisionId: input.baseRevisionId,
                    revision: created.revision,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
        });
        return this.story(canonicalStoryId);
    }

    async listStorySubtypes(input?: { kind?: StoryKind }): Promise<StorySubtypeRegistration[]> {
        return listRegisteredStorySubtypes(input);
    }

    async splitStory(input: {
        storyId: string;
        successors: readonly {
            title: string;
            summary: string | null;
            kind: "event" | "document" | "media" | "thread";
            subtype: string | null;
            entryIds: readonly string[];
            evidenceEntryIds: readonly string[];
            entityIds: readonly string[];
            topicIds: readonly string[];
        }[];
        actor?: string | null;
        reason?: string | null;
    }): Promise<StoryDetail | null> {
        const shellStoryId = await this.resolveCanonicalStoryId(input.storyId);
        if (!shellStoryId) {
            throw new StoryNotFoundError(input.storyId);
        }
        if (input.successors.length < 2) {
            throw new StorySplitConflictError("A Story split needs at least two successors.");
        }
        const shell = await this.prisma.story.findUnique({
            where: { id: shellStoryId },
            include: {
                currentRevision: { select: { id: true } },
                entries: { select: { id: true } },
                entryLinks: { select: { entryId: true } },
                storyEntities: { select: { entityId: true } },
                topicMemberships: {
                    select: {
                        topicId: true,
                        currentRevision: { select: { tombstone: true } },
                    },
                },
                successors: { select: { id: true } },
            },
        });
        if (!shell || !shell.currentRevision) {
            throw new StoryNotFoundError(input.storyId);
        }
        if (shell.successors.length > 0) {
            throw new StorySplitConflictError(`Story is already split: ${shellStoryId}`);
        }
        const memberEntryIds = new Set(shell.entries.map((entry) => entry.id));
        if (memberEntryIds.size === 0) {
            throw new StorySplitConflictError(`Story has no current members to split: ${shellStoryId}`);
        }
        const linkedEntryIds = new Set(shell.entryLinks.map((link) => link.entryId));
        const linkedEntityIds = new Set(shell.storyEntities.map((link) => link.entityId));
        const memberTopicIds = new Set(
            shell.topicMemberships
                .filter((membership) => membership.currentRevision?.tombstone === false)
                .map((membership) => membership.topicId),
        );
        const claimedEntryIds = new Set<string>();
        const claimedEvidenceEntryIds = new Set<string>();
        const claimedEntityIds = new Set<string>();
        const claimedTopicIds = new Set<string>();
        for (const successor of input.successors) {
            assertStorySubtype(successor.kind, successor.subtype);
            const successorEntryIds = new Set(successor.entryIds);
            for (const entryId of successorEntryIds) {
                if (!memberEntryIds.has(entryId)) {
                    throw new StorySplitConflictError(
                        `Entry is not a current member of the Story being split: ${entryId}`,
                    );
                }
                if (claimedEntryIds.has(entryId)) {
                    throw new StorySplitConflictError(
                        `Entry is assigned to more than one successor: ${entryId}`,
                    );
                }
                claimedEntryIds.add(entryId);
            }
            for (const entryId of new Set(successor.evidenceEntryIds)) {
                if (!linkedEntryIds.has(entryId)) {
                    throw new StorySplitConflictError(
                        `Entry is not linked to the Story being split: ${entryId}`,
                    );
                }
                if (claimedEvidenceEntryIds.has(entryId)) {
                    throw new StorySplitConflictError(
                        `Evidence link is assigned to more than one successor: ${entryId}`,
                    );
                }
                // A moved link must not point at its own primary Story
                // (ADR-0011 decision 3).
                if (successorEntryIds.has(entryId)) {
                    throw new StorySplitConflictError(
                        `An Entry cannot be evidence for its own primary successor Story: ${entryId}`,
                    );
                }
                claimedEvidenceEntryIds.add(entryId);
            }
            for (const entityId of new Set(successor.entityIds)) {
                if (!linkedEntityIds.has(entityId)) {
                    throw new StorySplitConflictError(
                        `Entity is not linked to the Story being split: ${entityId}`,
                    );
                }
                if (claimedEntityIds.has(entityId)) {
                    throw new StorySplitConflictError(
                        `Story↔Entity link is assigned to more than one successor: ${entityId}`,
                    );
                }
                claimedEntityIds.add(entityId);
            }
            for (const topicId of new Set(successor.topicIds)) {
                if (!memberTopicIds.has(topicId)) {
                    throw new StorySplitConflictError(
                        `Topic is not a current membership of the Story being split: ${topicId}`,
                    );
                }
                if (claimedTopicIds.has(topicId)) {
                    throw new StorySplitConflictError(
                        `Topic membership is assigned to more than one successor: ${topicId}`,
                    );
                }
                claimedTopicIds.add(topicId);
            }
        }
        const actorJson = input.actor == null ? null : JSON.stringify(input.actor);
        await this.prisma.$transaction(async (tx) => {
            const successorStoryIds: string[] = [];
            for (const successor of input.successors) {
                const successorStoryId = `story:${randomUUID()}`;
                successorStoryIds.push(successorStoryId);
                await tx.story.create({
                    data: {
                        id: successorStoryId,
                        kind: successor.kind,
                        subtype: successor.subtype,
                    },
                });
                const revision = await tx.storyRevision.create({
                    data: {
                        story: { connect: { id: successorStoryId } },
                        revision: 1,
                        fingerprint: fingerprintStoryRevision({
                            title: successor.title,
                            summary: successor.summary,
                            kind: successor.kind,
                            subtype: successor.subtype,
                        }),
                        actorJson,
                        reason: input.reason ?? null,
                        title: successor.title,
                        summary: successor.summary,
                    },
                });
                await tx.story.update({
                    where: { id: successorStoryId },
                    data: { currentRevisionId: revision.id },
                });
                if (successor.entryIds.length > 0) {
                    await tx.entry.updateMany({
                        where: { id: { in: [...successor.entryIds] } },
                        data: { storyId: successorStoryId },
                    });
                }
                if (successor.evidenceEntryIds.length > 0) {
                    await tx.entryStoryLink.updateMany({
                        where: {
                            storyId: shellStoryId,
                            entryId: { in: [...successor.evidenceEntryIds] },
                        },
                        data: { storyId: successorStoryId },
                    });
                }
                if (successor.entityIds.length > 0) {
                    await tx.storyEntity.updateMany({
                        where: {
                            storyId: shellStoryId,
                            entityId: { in: [...successor.entityIds] },
                        },
                        data: { storyId: successorStoryId },
                    });
                }
                if (successor.topicIds.length > 0) {
                    await tx.topicMembership.updateMany({
                        where: {
                            storyId: shellStoryId,
                            topicId: { in: [...successor.topicIds] },
                        },
                        data: { storyId: successorStoryId },
                    });
                }
                await tx.storyReplacement.create({
                    data: {
                        storyId: shellStoryId,
                        successorStoryId,
                        actorJson,
                        reason: input.reason ?? null,
                    },
                });
                await appendDomainEvent(tx, {
                    type: "story.revision_created.v1",
                    aggregateType: "Story",
                    aggregateId: successorStoryId,
                    payload: {
                        storyId: successorStoryId,
                        baseRevisionId: null,
                        revision: 1,
                        cause: "split",
                        actor: input.actor ?? null,
                        reason: input.reason ?? null,
                    },
                });
            }
            await appendDomainEvent(tx, {
                type: "story.split.v1",
                aggregateType: "Story",
                aggregateId: shellStoryId,
                payload: {
                    storyId: shellStoryId,
                    successors: input.successors.map((successor, index) => ({
                        storyId: successorStoryIds[index],
                        entryIds: [...successor.entryIds],
                        evidenceEntryIds: [...successor.evidenceEntryIds],
                        entityIds: [...successor.entityIds],
                        topicIds: [...successor.topicIds],
                    })),
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
        });
        return this.story(shellStoryId);
    }

}
