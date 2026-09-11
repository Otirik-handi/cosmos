import { type StoryDetail } from "@cosmos/contracts";
import { StoryMergeConflictError, StoryNotFoundError } from "@cosmos/application";
import { appendDomainEvent } from "./repository-internals.js";
import { PrismaCosmosRepositoryStories } from "./stories.js";

export class PrismaCosmosRepositoryStoryMerge extends PrismaCosmosRepositoryStories {
    async mergeStories(input: {
        canonicalStoryId: string;
        obsoleteStoryIds: readonly string[];
        actor?: string | null;
        reason?: string | null;
    }): Promise<StoryDetail | null> {
        const canonicalStoryId = await this.resolveCanonicalStoryId(input.canonicalStoryId);
        if (!canonicalStoryId) {
            throw new StoryNotFoundError(input.canonicalStoryId);
        }
        const obsoleteStoryIds = [...new Set(input.obsoleteStoryIds)];
        if (obsoleteStoryIds.includes(canonicalStoryId)) {
            throw new StoryMergeConflictError(`Cannot merge Story into itself: ${canonicalStoryId}`);
        }
        if (await this.isStoryShell(canonicalStoryId)) {
            throw new StoryMergeConflictError(`Cannot merge into a split Story shell: ${canonicalStoryId}`);
        }
        for (const obsoleteStoryId of obsoleteStoryIds) {
            const resolvedObsolete = await this.resolveCanonicalStoryId(obsoleteStoryId);
            if (!resolvedObsolete) {
                throw new StoryNotFoundError(obsoleteStoryId);
            }
            if (resolvedObsolete !== obsoleteStoryId) {
                throw new StoryMergeConflictError(`Story is already merged: ${obsoleteStoryId}`);
            }
            if (await this.isStoryShell(obsoleteStoryId)) {
                throw new StoryMergeConflictError(`Cannot merge a split Story shell: ${obsoleteStoryId}`);
            }
        }
        await this.prisma.$transaction(async (tx) => {
            for (const obsoleteStoryId of obsoleteStoryIds) {
                await tx.entry.updateMany({
                    where: { storyId: obsoleteStoryId },
                    data: { storyId: canonicalStoryId },
                });
                // Auxiliary Entry↔Story links follow the same merge: links that
                // pointed at the merged-away Story move to the canonical Story,
                // collapsing to one per (entry, story); links that would end up
                // pointing at the Entry's own primary Story are dropped
                // (ADR-0011 decision 4).
                const obsoleteEntryLinks = await tx.entryStoryLink.findMany({
                    where: { storyId: obsoleteStoryId },
                });
                for (const link of obsoleteEntryLinks) {
                    const existing = await tx.entryStoryLink.findUnique({
                        where: {
                            entryId_storyId: {
                                entryId: link.entryId,
                                storyId: canonicalStoryId,
                            },
                        },
                    });
                    if (!existing) {
                        await tx.entryStoryLink.update({
                            where: { id: link.id },
                            data: { storyId: canonicalStoryId },
                        });
                    } else {
                        await tx.entryStoryLink.delete({
                            where: { id: link.id },
                        });
                        await appendDomainEvent(tx, {
                            type: "entry_story.merged.v1",
                            aggregateType: "Entry",
                            aggregateId: link.entryId,
                            payload: {
                                entryId: link.entryId,
                                obsoleteStoryId,
                                canonicalStoryId,
                                actor: input.actor ?? null,
                                reason: input.reason ?? null,
                            },
                        });
                    }
                }
                await tx.entryStoryLink.deleteMany({
                    where: {
                        storyId: canonicalStoryId,
                        entry: { storyId: canonicalStoryId },
                    },
                });
                // Topic memberships point at a Story id; a merged-away Story must
                // not leave duplicate memberships behind on its alias id. Migrate
                // them to the canonical Story, collapsing to one per (topic, story)
                // (ADR-0007 decision 4).
                const obsoleteMemberships = await tx.topicMembership.findMany({
                    where: { storyId: obsoleteStoryId },
                });
                for (const membership of obsoleteMemberships) {
                    const existing = await tx.topicMembership.findUnique({
                        where: {
                            topicId_storyId: {
                                topicId: membership.topicId,
                                storyId: canonicalStoryId,
                            },
                        },
                    });
                    if (!existing) {
                        await tx.topicMembership.update({
                            where: { id: membership.id },
                            data: { storyId: canonicalStoryId },
                        });
                    } else {
                        await tx.topicMembership.delete({
                            where: { id: membership.id },
                        });
                        await appendDomainEvent(tx, {
                            type: "topic.membership_merged.v1",
                            aggregateType: "Topic",
                            aggregateId: membership.topicId,
                            payload: {
                                topicId: membership.topicId,
                                obsoleteStoryId,
                                canonicalStoryId,
                                actor: input.actor ?? null,
                                reason: input.reason ?? null,
                            },
                        });
                    }
                }
                // Story↔Entity links point at the same Story id space and must
                // follow the merge to the canonical Story, collapsing to one per
                // (story, entity) (ADR-0008 decision 3).
                const obsoleteStoryEntities = await tx.storyEntity.findMany({
                    where: { storyId: obsoleteStoryId },
                });
                for (const link of obsoleteStoryEntities) {
                    const existing = await tx.storyEntity.findUnique({
                        where: {
                            storyId_entityId: {
                                storyId: canonicalStoryId,
                                entityId: link.entityId,
                            },
                        },
                    });
                    if (!existing) {
                        await tx.storyEntity.update({
                            where: { id: link.id },
                            data: { storyId: canonicalStoryId },
                        });
                    } else {
                        await tx.storyEntity.delete({
                            where: { id: link.id },
                        });
                        await appendDomainEvent(tx, {
                            type: "story_entity.merged.v1",
                            aggregateType: "Entity",
                            aggregateId: link.entityId,
                            payload: {
                                entityId: link.entityId,
                                obsoleteStoryId,
                                canonicalStoryId,
                                actor: input.actor ?? null,
                                reason: input.reason ?? null,
                            },
                        });
                    }
                }
                // User-organization state keyed by Story id follows the same
                // merge: Collections keep at most one (collection, story) member,
                // a Story favorite collapses to one row, and label assignments
                // move to the canonical Story unless the label is already there
                // (ADR-0009 decisions 3 and the merge symmetric to ADR-0007/0008).
                const obsoleteCollectionItems = await tx.collectionItem.findMany({
                    where: { storyId: obsoleteStoryId },
                });
                for (const item of obsoleteCollectionItems) {
                    const existing = await tx.collectionItem.findUnique({
                        where: {
                            collectionId_storyId: {
                                collectionId: item.collectionId,
                                storyId: canonicalStoryId,
                            },
                        },
                    });
                    if (!existing) {
                        await tx.collectionItem.update({
                            where: { id: item.id },
                            data: { storyId: canonicalStoryId },
                        });
                    } else {
                        await tx.collectionItem.delete({ where: { id: item.id } });
                        await appendDomainEvent(tx, {
                            type: "collection.item_merged.v1",
                            aggregateType: "Collection",
                            aggregateId: item.collectionId,
                            payload: {
                                collectionId: item.collectionId,
                                obsoleteStoryId,
                                canonicalStoryId,
                                actor: input.actor ?? null,
                                reason: input.reason ?? null,
                            },
                        });
                    }
                }
                const obsoleteFavorites = await tx.favorite.findMany({
                    where: { targetType: "story", targetId: obsoleteStoryId },
                });
                for (const favorite of obsoleteFavorites) {
                    const existing = await tx.favorite.findUnique({
                        where: {
                            targetType_targetId: {
                                targetType: "story",
                                targetId: canonicalStoryId,
                            },
                        },
                    });
                    if (!existing) {
                        await tx.favorite.update({
                            where: { id: favorite.id },
                            data: { targetId: canonicalStoryId },
                        });
                    } else {
                        await tx.favorite.delete({ where: { id: favorite.id } });
                        await appendDomainEvent(tx, {
                            type: "favorite.merged.v1",
                            aggregateType: "Story",
                            aggregateId: canonicalStoryId,
                            payload: {
                                targetType: "story",
                                obsoleteStoryId,
                                canonicalStoryId,
                                actor: input.actor ?? null,
                                reason: input.reason ?? null,
                            },
                        });
                    }
                }
                const obsoleteStoryLabels = await tx.labelAssignment.findMany({
                    where: { targetType: "story", targetId: obsoleteStoryId },
                });
                for (const assignment of obsoleteStoryLabels) {
                    const existing = await tx.labelAssignment.findUnique({
                        where: {
                            labelId_targetType_targetId: {
                                labelId: assignment.labelId,
                                targetType: "story",
                                targetId: canonicalStoryId,
                            },
                        },
                    });
                    if (!existing) {
                        await tx.labelAssignment.update({
                            where: { id: assignment.id },
                            data: { targetId: canonicalStoryId },
                        });
                    } else {
                        await tx.labelAssignment.delete({ where: { id: assignment.id } });
                        await appendDomainEvent(tx, {
                            type: "label.assignment_merged.v1",
                            aggregateType: "Label",
                            aggregateId: assignment.labelId,
                            payload: {
                                labelId: assignment.labelId,
                                obsoleteStoryId,
                                canonicalStoryId,
                                actor: input.actor ?? null,
                                reason: input.reason ?? null,
                            },
                        });
                    }
                }
                // Annotations have no per-target uniqueness, so they only need
                // their targetId re-pointed to the canonical Story (ADR-0009).
                const obsoleteStoryAnnotations = await tx.annotation.findMany({
                    where: { targetType: "story", targetId: obsoleteStoryId },
                });
                for (const annotation of obsoleteStoryAnnotations) {
                    await tx.annotation.update({
                        where: { id: annotation.id },
                        data: { targetId: canonicalStoryId },
                    });
                }
                // Spotlight placements are keyed by (board, targetType, targetId):
                // move them to the canonical Story, dropping a placement that
                // would collide on the same board (ADR-0010 decision 3).
                const obsoletePlacements = await tx.spotlightPlacement.findMany({
                    where: { targetType: "story", targetId: obsoleteStoryId },
                });
                for (const placement of obsoletePlacements) {
                    const existing = await tx.spotlightPlacement.findUnique({
                        where: {
                            boardId_targetType_targetId: {
                                boardId: placement.boardId,
                                targetType: "story",
                                targetId: canonicalStoryId,
                            },
                        },
                    });
                    if (!existing) {
                        await tx.spotlightPlacement.update({
                            where: { id: placement.id },
                            data: { targetId: canonicalStoryId },
                        });
                    } else {
                        await tx.spotlightPlacement.delete({ where: { id: placement.id } });
                        await appendDomainEvent(tx, {
                            type: "spotlight.placement_merged.v1",
                            aggregateType: "Story",
                            aggregateId: canonicalStoryId,
                            payload: {
                                placementId: placement.id,
                                boardId: placement.boardId,
                                obsoleteStoryId,
                                canonicalStoryId,
                                actor: input.actor ?? null,
                                reason: input.reason ?? null,
                            },
                        });
                    }
                }
                await tx.storyAlias.create({
                    data: { id: obsoleteStoryId, canonicalStoryId },
                });
                await appendDomainEvent(tx, {
                    type: "story.merged.v1",
                    aggregateType: "Story",
                    aggregateId: canonicalStoryId,
                    payload: {
                        obsoleteStoryId,
                        canonicalStoryId,
                        actor: input.actor ?? null,
                        reason: input.reason ?? null,
                    },
                });
            }
        });
        return this.story(canonicalStoryId);
    }

}
