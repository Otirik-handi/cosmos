import { type TopicDetail, type TopicPage, type TopicSummary } from "@cosmos/contracts";
import { fingerprintTopicRevision, type TopicMemberRole } from "@cosmos/domain";
import { StoryNotFoundError, TopicMergeConflictError, TopicMembershipNotFoundError, TopicNotFoundError, TopicRevisionConflictError } from "@cosmos/application";
import { appendDomainEvent } from "./repository-internals.js";
import { PrismaCosmosRepositoryStoryMerge } from "./story-merge.js";

export class PrismaCosmosRepositoryTopics extends PrismaCosmosRepositoryStoryMerge {
    async createTopic(input: {
        title: string;
        purpose: string;
        scope: string | null;
        seedStoryId?: string | null;
        actor?: string | null;
        reason?: string | null;
    }): Promise<TopicDetail | null> {
        let canonicalSeedStoryId: string | null = null;
        if (input.seedStoryId) {
            canonicalSeedStoryId = await this.resolveCanonicalStoryId(input.seedStoryId);
            if (!canonicalSeedStoryId) {
                throw new StoryNotFoundError(input.seedStoryId);
            }
        }
        const fingerprint = fingerprintTopicRevision({
            title: input.title,
            purpose: input.purpose,
            scope: input.scope,
        });
        const topicId = await this.prisma.$transaction(async (tx) => {
            const topic = await tx.topic.create({ data: {} });
            const revision = await tx.topicRevision.create({
                data: {
                    topicId: topic.id,
                    revision: 1,
                    fingerprint,
                    actorJson: input.actor == null ? null : JSON.stringify(input.actor),
                    reason: input.reason ?? null,
                    title: input.title,
                    purpose: input.purpose,
                    scope: input.scope,
                },
            });
            await tx.topic.update({
                where: { id: topic.id },
                data: { currentRevisionId: revision.id },
            });
            if (canonicalSeedStoryId) {
                const membership = await tx.topicMembership.create({
                    data: { topicId: topic.id, storyId: canonicalSeedStoryId },
                });
                await this.appendMembershipRevision(tx, {
                    membershipId: membership.id,
                    role: "core",
                    reason: "seed",
                    actor: input.actor ?? null,
                    tombstone: false,
                });
            }
            await appendDomainEvent(tx, {
                type: "topic.created.v1",
                aggregateType: "Topic",
                aggregateId: topic.id,
                payload: {
                    topicId: topic.id,
                    seedStoryId: canonicalSeedStoryId,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
            return topic.id;
        });
        return this.toTopicDetail(topicId);
    }

    async updateTopic(input: {
        topicId: string;
        baseRevisionId: string;
        title: string;
        purpose: string;
        scope: string | null;
        actor?: string | null;
        reason?: string | null;
    }): Promise<TopicDetail | null> {
        const canonicalTopicId = await this.resolveCanonicalTopicId(input.topicId);
        if (!canonicalTopicId) {
            throw new TopicNotFoundError(input.topicId);
        }
        const topic = await this.prisma.topic.findUnique({
            where: { id: canonicalTopicId },
            include: { currentRevision: true },
        });
        if (!topic) {
            throw new TopicNotFoundError(input.topicId);
        }
        if (!topic.currentRevision || topic.currentRevision.id !== input.baseRevisionId) {
            throw new TopicRevisionConflictError(input.topicId);
        }
        const fingerprint = fingerprintTopicRevision({
            title: input.title,
            purpose: input.purpose,
            scope: input.scope,
        });
        if (topic.currentRevision.fingerprint === fingerprint) {
            return this.toTopicDetail(canonicalTopicId);
        }
        await this.prisma.$transaction(async (tx) => {
            const latest = await tx.topicRevision.findFirst({
                where: { topicId: canonicalTopicId },
                orderBy: { revision: "desc" },
                select: { revision: true },
            });
            const created = await tx.topicRevision.create({
                data: {
                    topicId: canonicalTopicId,
                    revision: (latest?.revision ?? 0) + 1,
                    fingerprint,
                    actorJson: input.actor == null ? null : JSON.stringify(input.actor),
                    reason: input.reason ?? null,
                    title: input.title,
                    purpose: input.purpose,
                    scope: input.scope,
                },
            });
            await tx.topic.update({
                where: { id: canonicalTopicId },
                data: { currentRevisionId: created.id },
            });
            await appendDomainEvent(tx, {
                type: "topic.revision_created.v1",
                aggregateType: "Topic",
                aggregateId: canonicalTopicId,
                payload: {
                    topicId: canonicalTopicId,
                    baseRevisionId: input.baseRevisionId,
                    revision: created.revision,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
        });
        return this.toTopicDetail(canonicalTopicId);
    }

    async mergeTopics(input: {
        canonicalTopicId: string;
        obsoleteTopicIds: readonly string[];
        actor?: string | null;
        reason?: string | null;
    }): Promise<TopicDetail | null> {
        const canonicalTopicId = await this.resolveCanonicalTopicId(input.canonicalTopicId);
        if (!canonicalTopicId) {
            throw new TopicNotFoundError(input.canonicalTopicId);
        }
        const obsoleteTopicIds = [...new Set(input.obsoleteTopicIds)];
        if (obsoleteTopicIds.includes(canonicalTopicId)) {
            throw new TopicMergeConflictError(`Cannot merge Topic into itself: ${canonicalTopicId}`);
        }
        for (const obsoleteTopicId of obsoleteTopicIds) {
            const resolved = await this.resolveCanonicalTopicId(obsoleteTopicId);
            if (!resolved) {
                throw new TopicNotFoundError(obsoleteTopicId);
            }
            if (resolved !== obsoleteTopicId) {
                throw new TopicMergeConflictError(`Topic is already merged: ${obsoleteTopicId}`);
            }
        }
        await this.prisma.$transaction(async (tx) => {
            for (const obsoleteTopicId of obsoleteTopicIds) {
                const obsoleteMemberships = await tx.topicMembership.findMany({
                    where: { topicId: obsoleteTopicId },
                });
                for (const membership of obsoleteMemberships) {
                    const existing = await this.findTopicMembership(
                        tx,
                        canonicalTopicId,
                        membership.storyId,
                    );
                    if (!existing) {
                        await tx.topicMembership.update({
                            where: { id: membership.id },
                            data: { topicId: canonicalTopicId },
                        });
                    } else {
                        await tx.topicMembership.delete({
                            where: { id: membership.id },
                        });
                        await appendDomainEvent(tx, {
                            type: "topic.membership_merged.v1",
                            aggregateType: "Topic",
                            aggregateId: canonicalTopicId,
                            payload: {
                                obsoleteTopicId,
                                canonicalTopicId,
                                storyId: membership.storyId,
                                actor: input.actor ?? null,
                                reason: input.reason ?? null,
                            },
                        });
                    }
                }
                // Spotlight placements keyed by Topic id follow the merge and
                // collapse on a same-board collision (ADR-0010 decision 3).
                const obsoletePlacements = await tx.spotlightPlacement.findMany({
                    where: { targetType: "topic", targetId: obsoleteTopicId },
                });
                for (const placement of obsoletePlacements) {
                    const existing = await tx.spotlightPlacement.findUnique({
                        where: {
                            boardId_targetType_targetId: {
                                boardId: placement.boardId,
                                targetType: "topic",
                                targetId: canonicalTopicId,
                            },
                        },
                    });
                    if (!existing) {
                        await tx.spotlightPlacement.update({
                            where: { id: placement.id },
                            data: { targetId: canonicalTopicId },
                        });
                    } else {
                        await tx.spotlightPlacement.delete({ where: { id: placement.id } });
                        await appendDomainEvent(tx, {
                            type: "spotlight.placement_merged.v1",
                            aggregateType: "Topic",
                            aggregateId: canonicalTopicId,
                            payload: {
                                placementId: placement.id,
                                boardId: placement.boardId,
                                obsoleteTopicId,
                                canonicalTopicId,
                                actor: input.actor ?? null,
                                reason: input.reason ?? null,
                            },
                        });
                    }
                }
                await tx.topicAlias.create({
                    data: { id: obsoleteTopicId, canonicalTopicId },
                });
                await appendDomainEvent(tx, {
                    type: "topic.merged.v1",
                    aggregateType: "Topic",
                    aggregateId: canonicalTopicId,
                    payload: {
                        obsoleteTopicId,
                        canonicalTopicId,
                        actor: input.actor ?? null,
                        reason: input.reason ?? null,
                    },
                });
            }
        });
        return this.toTopicDetail(canonicalTopicId);
    }

    async listTopics(input: {
        cursor?: string;
        limit: number;
    }): Promise<TopicPage> {
        const parsed = input.cursor ? Number.parseInt(input.cursor, 10) : 0;
        const offset = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
        const topics = await this.prisma.topic.findMany({
            orderBy: { updatedAt: "desc" },
            skip: offset,
            take: input.limit + 1,
            include: {
                currentRevision: true,
                memberships: { include: { currentRevision: true } },
            },
        });
        const hasNext = topics.length > input.limit;
        const page = hasNext ? topics.slice(0, input.limit) : topics;
        const items: TopicSummary[] = page.map((topic) => ({
            id: topic.id,
            revisionId: topic.currentRevision?.id ?? "",
            title: topic.currentRevision?.title ?? "",
            purpose: topic.currentRevision?.purpose ?? "",
            scope: topic.currentRevision?.scope ?? null,
            memberCount: topic.memberships.filter((membership) => {
                return membership.currentRevision !== null
                    && !membership.currentRevision.tombstone;
            }).length,
            updatedAt: topic.updatedAt.toISOString(),
        }));
        return {
            items,
            nextCursor: hasNext ? String(offset + input.limit) : null,
        };
    }

    async addTopicMember(input: {
        topicId: string;
        storyId: string;
        role: TopicMemberRole;
        reason?: string | null;
        actor?: string | null;
    }): Promise<TopicDetail | null> {
        const canonicalTopicId = await this.resolveCanonicalTopicId(input.topicId);
        if (!canonicalTopicId) {
            throw new TopicNotFoundError(input.topicId);
        }
        const canonicalStoryId = await this.resolveCanonicalStoryId(input.storyId);
        if (!canonicalStoryId) {
            throw new StoryNotFoundError(input.storyId);
        }
        await this.prisma.$transaction(async (tx) => {
            const membership = await this.findTopicMembership(
                tx,
                canonicalTopicId,
                canonicalStoryId,
            );
            if (!membership) {
                const created = await tx.topicMembership.create({
                    data: { topicId: canonicalTopicId, storyId: canonicalStoryId },
                });
                await this.appendMembershipRevision(tx, {
                    membershipId: created.id,
                    role: input.role,
                    reason: input.reason ?? null,
                    actor: input.actor ?? null,
                    tombstone: false,
                });
                await appendDomainEvent(tx, {
                    type: "topic.member_added.v1",
                    aggregateType: "Topic",
                    aggregateId: canonicalTopicId,
                    payload: {
                        topicId: canonicalTopicId,
                        storyId: canonicalStoryId,
                        role: input.role,
                        actor: input.actor ?? null,
                        reason: input.reason ?? null,
                    },
                });
                return;
            }
            if (membership.currentRevision && !membership.currentRevision.tombstone) {
                // Already an active member; role changes go through update-role.
                return;
            }
            await this.appendMembershipRevision(tx, {
                membershipId: membership.id,
                role: input.role,
                reason: input.reason ?? null,
                actor: input.actor ?? null,
                tombstone: false,
            });
            await appendDomainEvent(tx, {
                type: "topic.member_added.v1",
                aggregateType: "Topic",
                aggregateId: canonicalTopicId,
                payload: {
                    topicId: canonicalTopicId,
                    storyId: canonicalStoryId,
                    role: input.role,
                    restored: true,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
        });
        return this.toTopicDetail(canonicalTopicId);
    }

    async updateTopicMemberRole(input: {
        topicId: string;
        storyId: string;
        role: TopicMemberRole;
        reason?: string | null;
        actor?: string | null;
    }): Promise<TopicDetail | null> {
        const canonicalTopicId = await this.resolveCanonicalTopicId(input.topicId);
        if (!canonicalTopicId) {
            throw new TopicNotFoundError(input.topicId);
        }
        const canonicalStoryId = await this.resolveCanonicalStoryId(input.storyId);
        if (!canonicalStoryId) {
            throw new StoryNotFoundError(input.storyId);
        }
        await this.prisma.$transaction(async (tx) => {
            const membership = await this.findTopicMembership(
                tx,
                canonicalTopicId,
                canonicalStoryId,
            );
            if (!membership || !membership.currentRevision || membership.currentRevision.tombstone) {
                throw new TopicMembershipNotFoundError(
                    `Topic member not found or removed: ${input.topicId}/${input.storyId}`,
                );
            }
            if (membership.currentRevision.role === input.role) {
                return;
            }
            await this.appendMembershipRevision(tx, {
                membershipId: membership.id,
                role: input.role,
                reason: input.reason ?? null,
                actor: input.actor ?? null,
                tombstone: false,
            });
            await appendDomainEvent(tx, {
                type: "topic.member_role_updated.v1",
                aggregateType: "Topic",
                aggregateId: canonicalTopicId,
                payload: {
                    topicId: canonicalTopicId,
                    storyId: canonicalStoryId,
                    role: input.role,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
        });
        return this.toTopicDetail(canonicalTopicId);
    }

    async removeTopicMember(input: {
        topicId: string;
        storyId: string;
        reason?: string | null;
        actor?: string | null;
    }): Promise<TopicDetail | null> {
        const canonicalTopicId = await this.resolveCanonicalTopicId(input.topicId);
        if (!canonicalTopicId) {
            throw new TopicNotFoundError(input.topicId);
        }
        const canonicalStoryId = await this.resolveCanonicalStoryId(input.storyId);
        if (!canonicalStoryId) {
            throw new StoryNotFoundError(input.storyId);
        }
        await this.prisma.$transaction(async (tx) => {
            const membership = await this.findTopicMembership(
                tx,
                canonicalTopicId,
                canonicalStoryId,
            );
            if (!membership || !membership.currentRevision) {
                throw new TopicMembershipNotFoundError(
                    `Topic member not found: ${input.topicId}/${input.storyId}`,
                );
            }
            if (membership.currentRevision.tombstone) {
                return;
            }
            await this.appendMembershipRevision(tx, {
                membershipId: membership.id,
                role: membership.currentRevision.role,
                reason: input.reason ?? null,
                actor: input.actor ?? null,
                tombstone: true,
            });
            await appendDomainEvent(tx, {
                type: "topic.member_removed.v1",
                aggregateType: "Topic",
                aggregateId: canonicalTopicId,
                payload: {
                    topicId: canonicalTopicId,
                    storyId: canonicalStoryId,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
        });
        return this.toTopicDetail(canonicalTopicId);
    }

    async restoreTopicMember(input: {
        topicId: string;
        storyId: string;
        role: TopicMemberRole;
        reason?: string | null;
        actor?: string | null;
    }): Promise<TopicDetail | null> {
        const canonicalTopicId = await this.resolveCanonicalTopicId(input.topicId);
        if (!canonicalTopicId) {
            throw new TopicNotFoundError(input.topicId);
        }
        const canonicalStoryId = await this.resolveCanonicalStoryId(input.storyId);
        if (!canonicalStoryId) {
            throw new StoryNotFoundError(input.storyId);
        }
        await this.prisma.$transaction(async (tx) => {
            const membership = await this.findTopicMembership(
                tx,
                canonicalTopicId,
                canonicalStoryId,
            );
            if (!membership || !membership.currentRevision) {
                throw new TopicMembershipNotFoundError(
                    `Topic member not found: ${input.topicId}/${input.storyId}`,
                );
            }
            if (!membership.currentRevision.tombstone) {
                return;
            }
            await this.appendMembershipRevision(tx, {
                membershipId: membership.id,
                role: input.role,
                reason: input.reason ?? null,
                actor: input.actor ?? null,
                tombstone: false,
            });
            await appendDomainEvent(tx, {
                type: "topic.member_restored.v1",
                aggregateType: "Topic",
                aggregateId: canonicalTopicId,
                payload: {
                    topicId: canonicalTopicId,
                    storyId: canonicalStoryId,
                    role: input.role,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
        });
        return this.toTopicDetail(canonicalTopicId);
    }

}
