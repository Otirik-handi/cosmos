import { type StoryUserStateMigrationResult } from "@cosmos/contracts";
import { StoryNotFoundError, StoryUserStateMigrationConflictError } from "@cosmos/application";
import { appendDomainEvent } from "./repository-internals.js";
import { PrismaCosmosRepositoryStoryMerge } from "./story-merge.js";

/**
 * Moving Story-target user state inside one split family (ADR-0020).
 *
 * Only rows whose target is the Story itself are moved. State attached to an
 * Entry or a Topic belongs to that object and follows it on its own, so a
 * migration never touches it; naming such a row here fails the ownership check
 * below instead of silently moving the wrong thing.
 *
 * Undo is the same command run in the opposite direction (ADR-0020 decision 3),
 * which is why nothing here writes a migration ledger: the caller re-declares
 * what should move back, and the Story state it can currently see is the truth.
 */
export class PrismaCosmosRepositoryStoryUserState extends PrismaCosmosRepositoryStoryMerge {
    async migrateStoryUserState(input: {
        sourceStoryId: string;
        targetStoryId: string;
        favorite: boolean;
        labelIds: readonly string[];
        collectionIds: readonly string[];
        annotationIds: readonly string[];
        spotlightPlacementIds: readonly string[];
        actor?: string | null;
        reason?: string | null;
        basis?: string | null;
    }): Promise<StoryUserStateMigrationResult> {
        const sourceStoryId = await this.resolveCanonicalStoryId(input.sourceStoryId);
        if (!sourceStoryId) {
            throw new StoryNotFoundError(input.sourceStoryId);
        }
        const targetStoryId = await this.resolveCanonicalStoryId(input.targetStoryId);
        if (!targetStoryId) {
            throw new StoryNotFoundError(input.targetStoryId);
        }
        if (sourceStoryId === targetStoryId) {
            throw new StoryUserStateMigrationConflictError(
                `Source and target Story are the same: ${sourceStoryId}`,
            );
        }
        // The command only resolves the dislocation a split created, so both
        // ends must belong to one shell (ADR-0020 decision 4): moving user state
        // between unrelated Stories stays the job of the per-object commands.
        const sourceFamilyShellId = await this.splitFamilyShellId(sourceStoryId);
        const targetFamilyShellId = await this.splitFamilyShellId(targetStoryId);
        if (!sourceFamilyShellId || sourceFamilyShellId !== targetFamilyShellId) {
            throw new StoryUserStateMigrationConflictError(
                `User state can only move between a split Story shell and its successors: ${sourceStoryId} -> ${targetStoryId}`,
            );
        }
        const labelIds = [...new Set(input.labelIds)];
        const collectionIds = [...new Set(input.collectionIds)];
        const annotationIds = [...new Set(input.annotationIds)];
        const spotlightPlacementIds = [...new Set(input.spotlightPlacementIds)];

        const sourceFavorite = input.favorite
            ? await this.prisma.favorite.findUnique({
                where: { targetType_targetId: { targetType: "story", targetId: sourceStoryId } },
                select: { id: true },
            })
            : null;
        if (input.favorite && !sourceFavorite) {
            throw new StoryUserStateMigrationConflictError(
                `Story has no favorite to migrate: ${sourceStoryId}`,
            );
        }
        const sourceLabelAssignments = await this.prisma.labelAssignment.findMany({
            where: {
                labelId: { in: labelIds },
                targetType: "story",
                targetId: sourceStoryId,
            },
            select: { id: true, labelId: true },
        });
        if (sourceLabelAssignments.length !== labelIds.length) {
            throw new StoryUserStateMigrationConflictError(
                `A label is not on the source Story: ${sourceStoryId}`,
            );
        }
        const sourceCollectionItems = await this.prisma.collectionItem.findMany({
            where: { collectionId: { in: collectionIds }, storyId: sourceStoryId },
            select: { id: true, collectionId: true },
        });
        if (sourceCollectionItems.length !== collectionIds.length) {
            throw new StoryUserStateMigrationConflictError(
                `A collection membership is not on the source Story: ${sourceStoryId}`,
            );
        }
        const sourceAnnotationIds = (
            await this.prisma.annotation.findMany({
                where: {
                    id: { in: annotationIds },
                    targetType: "story",
                    targetId: sourceStoryId,
                },
                select: { id: true },
            })
        ).map((annotation) => annotation.id);
        if (sourceAnnotationIds.length !== annotationIds.length) {
            throw new StoryUserStateMigrationConflictError(
                `An annotation is not on the source Story: ${sourceStoryId}`,
            );
        }
        const sourcePlacements = await this.prisma.spotlightPlacement.findMany({
            where: {
                id: { in: spotlightPlacementIds },
                targetType: "story",
                targetId: sourceStoryId,
            },
            select: { id: true, boardId: true },
        });
        if (sourcePlacements.length !== spotlightPlacementIds.length) {
            throw new StoryUserStateMigrationConflictError(
                `A spotlight placement is not on the source Story: ${sourceStoryId}`,
            );
        }

        const result: StoryUserStateMigrationResult = {
            sourceStoryId,
            targetStoryId,
            favorite: { moved: 0, deduped: 0 },
            labelAssignments: { moved: 0, deduped: 0 },
            collectionItems: { moved: 0, deduped: 0 },
            annotations: { moved: 0, deduped: 0 },
            spotlightPlacements: { moved: 0, deduped: 0 },
        };
        await this.prisma.$transaction(async (tx) => {
            if (sourceFavorite) {
                const existing = await tx.favorite.findUnique({
                    where: { targetType_targetId: { targetType: "story", targetId: targetStoryId } },
                    select: { id: true },
                });
                if (existing) {
                    await tx.favorite.delete({ where: { id: sourceFavorite.id } });
                    result.favorite.deduped += 1;
                } else {
                    await tx.favorite.update({
                        where: { id: sourceFavorite.id },
                        data: { targetId: targetStoryId },
                    });
                    result.favorite.moved += 1;
                }
            }
            for (const assignment of sourceLabelAssignments) {
                const existing = await tx.labelAssignment.findUnique({
                    where: {
                        labelId_targetType_targetId: {
                            labelId: assignment.labelId,
                            targetType: "story",
                            targetId: targetStoryId,
                        },
                    },
                    select: { id: true },
                });
                if (existing) {
                    await tx.labelAssignment.delete({ where: { id: assignment.id } });
                    result.labelAssignments.deduped += 1;
                } else {
                    await tx.labelAssignment.update({
                        where: { id: assignment.id },
                        data: { targetId: targetStoryId },
                    });
                    result.labelAssignments.moved += 1;
                }
            }
            for (const item of sourceCollectionItems) {
                const existing = await tx.collectionItem.findUnique({
                    where: {
                        collectionId_storyId: {
                            collectionId: item.collectionId,
                            storyId: targetStoryId,
                        },
                    },
                    select: { id: true },
                });
                if (existing) {
                    await tx.collectionItem.delete({ where: { id: item.id } });
                    result.collectionItems.deduped += 1;
                } else {
                    await tx.collectionItem.update({
                        where: { id: item.id },
                        data: { storyId: targetStoryId },
                    });
                    result.collectionItems.moved += 1;
                }
            }
            if (sourceAnnotationIds.length > 0) {
                // Annotations carry no per-target uniqueness, so they all move.
                // `targetRevisionId` stays as written: it fixes the Revision the
                // user was reading, and that Revision stays on the source Story.
                const updated = await tx.annotation.updateMany({
                    where: { id: { in: sourceAnnotationIds } },
                    data: { targetId: targetStoryId },
                });
                result.annotations.moved += updated.count;
            }
            for (const placement of sourcePlacements) {
                const existing = await tx.spotlightPlacement.findUnique({
                    where: {
                        boardId_targetType_targetId: {
                            boardId: placement.boardId,
                            targetType: "story",
                            targetId: targetStoryId,
                        },
                    },
                    select: { id: true },
                });
                if (existing) {
                    await tx.spotlightPlacement.delete({ where: { id: placement.id } });
                    result.spotlightPlacements.deduped += 1;
                } else {
                    await tx.spotlightPlacement.update({
                        where: { id: placement.id },
                        data: { targetId: targetStoryId },
                    });
                    result.spotlightPlacements.moved += 1;
                }
            }
            const touched = result.favorite.moved + result.favorite.deduped
                + result.labelAssignments.moved + result.labelAssignments.deduped
                + result.collectionItems.moved + result.collectionItems.deduped
                + result.annotations.moved + result.annotations.deduped
                + result.spotlightPlacements.moved + result.spotlightPlacements.deduped;
            if (touched > 0) {
                await appendDomainEvent(tx, {
                    type: "story.user_state_migrated.v1",
                    aggregateType: "Story",
                    aggregateId: sourceStoryId,
                    payload: {
                        sourceStoryId,
                        targetStoryId,
                        favorite: result.favorite,
                        labelAssignments: result.labelAssignments,
                        collectionItems: result.collectionItems,
                        annotations: result.annotations,
                        spotlightPlacements: result.spotlightPlacements,
                        actor: input.actor ?? null,
                        reason: input.reason ?? null,
                        basis: input.basis ?? null,
                    },
                });
            }
        });
        return result;
    }

    /** The shell a Story belongs to as shell or successor, or null when it is in no split family. */
    private async splitFamilyShellId(storyId: string): Promise<string | null> {
        const asShell = await this.prisma.storyReplacement.findFirst({
            where: { storyId },
            select: { storyId: true },
        });
        if (asShell) {
            return asShell.storyId;
        }
        const asSuccessor = await this.prisma.storyReplacement.findFirst({
            where: { successorStoryId: storyId },
            select: { storyId: true },
        });
        return asSuccessor?.storyId ?? null;
    }
}
