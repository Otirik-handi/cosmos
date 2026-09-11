import { contentKindSchema, sourceKindSchema, type ContentMetrics, type EntryDetail, type EntryPage, type EntryRelatedStory, type RevisionDetail, type Publisher, type StoryDetail, type TemporalValue, type TopicDetail, type LabelDetail } from "@cosmos/contracts";
import { type Prisma } from "@prisma/client";
import { exactTemporalValue, parseCursor, parseJson } from "./repository-internals.js";
import { PrismaCosmosRepositoryHelpers1 } from "./helpers-1.js";

export class PrismaCosmosRepositoryHelpers2 extends PrismaCosmosRepositoryHelpers1 {
    async entries(input: {
        sourceId?: string;
        cursor?: string;
        limit: number;
    }): Promise<EntryPage> {
        const offset = parseCursor(input.cursor);
        const entries = await this.prisma.entry.findMany({
            where: {
                currentRevisionId: { not: null },
                sourceInstanceId: input.sourceId,
            },
            orderBy: { updatedAt: "desc" },
            skip: offset,
            take: input.limit + 1,
            include: {
                sourceInstance: true,
                currentRevision: {
                    include: { assets: true },
                },
                _count: {
                    select: {
                        observations: true,
                        revisions: true,
                    },
                },
            },
        });
        const hasNext = entries.length > input.limit;
        const items = entries.slice(0, input.limit).flatMap((entry) => {
            if (!entry.currentRevision) {
                return [];
            }
            return [{
                id: entry.id,
                sourceId: entry.sourceInstance.id,
                sourceName: entry.sourceInstance.name,
                sourceKind: sourceKindSchema.parse(entry.sourceInstance.kind),
                storyId: entry.storyId,
                currentRevisionId: entry.currentRevision.id,
                title: entry.currentRevision.title,
                summary: entry.currentRevision.summary,
                webUrl: entry.currentRevision.webUrl,
                contentKind: contentKindSchema.parse(entry.currentRevision.contentKind),
                publisher: parseJson<Publisher>(entry.currentRevision.publisherJson),
                metrics: parseJson<ContentMetrics>(entry.metricsJson),
                publishedAt: entry.currentRevision.sourcePublishedAt?.toISOString() ?? null,
                updatedAt: entry.updatedAt.toISOString(),
                revisionCount: entry._count.revisions,
                observationCount: entry._count.observations,
                assets: entry.currentRevision.assets.map((asset) => this.toAssetSnapshot(asset)),
            }];
        });

        return {
            items,
            nextCursor: hasNext ? String(offset + input.limit) : null,
        };
    }

    protected async resolveCanonicalStoryId(storyId: string): Promise<string | null> {
        const alias = await this.prisma.storyAlias.findUnique({
            where: { id: storyId },
            select: { canonicalStoryId: true },
        });
        if (alias) {
            return alias.canonicalStoryId;
        }
        const story = await this.prisma.story.findUnique({
            where: { id: storyId },
            select: { id: true },
        });
        return story?.id ?? null;
    }

    // A Story with any replacement row is a historical shell: it keeps its id
    // and history but must not be merged, re-split or re-versioned
    // (ADR-0012 decision 6).
    async story(storyId: string): Promise<StoryDetail | null> {
        const canonicalId = await this.resolveCanonicalStoryId(storyId);
        if (!canonicalId) {
            return null;
        }
        const story = await this.prisma.story.findUnique({
            where: { id: canonicalId },
            include: {
                currentRevision: true,
                storyEntities: {
                    include: {
                        entity: {
                            include: { currentRevision: true },
                        },
                    },
                },
                entries: {
                    orderBy: { updatedAt: "desc" },
                    include: {
                        sourceInstance: true,
                        currentRevision: {
                            include: { assets: true },
                        },
                        revisions: {
                            orderBy: { revision: "desc" },
                            include: { assets: true },
                        },
                        observations: {
                            orderBy: { capturedAt: "desc" },
                        },
                    },
                },
            },
        });
        if (!story || !story.currentRevision) {
            return null;
        }
        // A historical shell may have no primary member left; it is still
        // readable through its current Revision and replacedBy list
        // (ADR-0012 decision 2).
        const shellReplacements = await this.prisma.storyReplacement.findMany({
            where: { storyId: canonicalId },
            include: { successor: { include: { currentRevision: { select: { title: true } } } } },
            orderBy: { createdAt: "asc" },
        });
        // Reverse view of the auxiliary relations: one query for every member
        // entry, then group in memory (ADR-0011 decision 6).
        const memberLinks = await this.prisma.entryStoryLink.findMany({
            where: { entryId: { in: story.entries.map((entry) => entry.id) } },
            include: { story: { include: { currentRevision: { select: { title: true } } } } },
        });
        const relatedByEntry = new Map<string, EntryRelatedStory[]>();
        for (const link of memberLinks) {
            const related = relatedByEntry.get(link.entryId) ?? [];
            related.push({
                storyId: link.storyId,
                relationType: link.relationType,
                title: link.story.currentRevision?.title ?? link.storyId,
                reason: link.reason,
            });
            relatedByEntry.set(link.entryId, related);
        }
        const toEntryDetail = (entry: (typeof story.entries)[number]): EntryDetail => ({
            id: entry.id,
            sourceId: entry.sourceInstance.id,
            sourceName: entry.sourceInstance.name,
            sourceKind: sourceKindSchema.parse(entry.sourceInstance.kind),
            currentRevisionId: entry.currentRevision!.id,
            metrics: parseJson<ContentMetrics>(entry.metricsJson),
            revisions: entry.revisions.map((revision) => ({
                id: revision.id,
                revision: revision.revision,
                title: revision.title,
                summary: revision.summary,
                contentText: revision.contentText,
                webUrl: revision.webUrl,
                contentKind: contentKindSchema.parse(revision.contentKind),
                publisher: parseJson<Publisher>(revision.publisherJson),
                publishedAt: parseJson<TemporalValue>(revision.publishedAtJson)
                    ?? exactTemporalValue(revision.sourcePublishedAt),
                updatedAt: parseJson<TemporalValue>(revision.updatedAtJson),
                sourcePublishedAt: revision.sourcePublishedAt?.toISOString() ?? null,
                createdAt: revision.createdAt.toISOString(),
                assets: revision.assets.map((asset) => this.toAssetSnapshot(asset)),
            })),
            observations: entry.observations.map((observation) => ({
                id: observation.id,
                externalId: observation.externalId,
                externalKey: observation.externalKey,
                eventKind: observation.eventKind as "create" | "update" | "delete" | "snapshot",
                webUrl: observation.webUrl,
                capturedAt: observation.capturedAt.toISOString(),
                sourcePublishedAt: observation.sourcePublishedAt?.toISOString() ?? null,
            })),
            relatedStories: relatedByEntry.get(entry.id) ?? [],
        });
        const entries = story.entries
            .filter((entry) => entry.currentRevision !== null)
            .map(toEntryDetail);
        const entities = story.storyEntities
            .filter((link) => link.entity.currentRevision !== null)
            .map((link) => ({
                entityId: link.entityId,
                name: link.entity.currentRevision!.name,
                type: link.entity.currentRevision!.type,
                producer: link.producer,
                producerVersion: link.producerVersion,
                confidence: link.confidence,
                evidence: link.evidence,
                actor: link.actorJson == null ? null : parseJson<string>(link.actorJson),
                reason: link.reason,
            }));
        // User-organization state for this Story: attached labels and the
        // lightweight favorite flag (ADR-0009). Queried separately because
        // LabelAssignment/Favorite carry polymorphic targets, not Story FKs.
        const [labelAssignments, favorite, evidenceLinks, topicMemberships] = await Promise.all([
            this.prisma.labelAssignment.findMany({
                where: { targetType: "story", targetId: canonicalId },
                include: { label: { select: { id: true, name: true } } },
            }),
            this.prisma.favorite.findUnique({
                where: {
                    targetType_targetId: { targetType: "story", targetId: canonicalId },
                },
                select: { id: true },
            }),
            // Auxiliary Entry↔Story relations: these entries are evidence for
            // (or mention) this Story without being primary members
            // (ADR-0011 decision 6).
            this.prisma.entryStoryLink.findMany({
                where: { storyId: canonicalId },
                orderBy: { createdAt: "desc" },
                include: {
                    entry: {
                        include: {
                            sourceInstance: { select: { id: true, name: true } },
                            currentRevision: { select: { title: true } },
                        },
                    },
                },
            }),
            // Active Topic memberships, so a client can decide which Topics a
            // split moves to which successor (ADR-0012 decision 3).
            this.prisma.topicMembership.findMany({
                where: { storyId: canonicalId, currentRevision: { tombstone: false } },
                include: {
                    currentRevision: { select: { role: true } },
                    topic: { include: { currentRevision: { select: { title: true } } } },
                },
            }),
        ]);
        return {
            story: {
                id: story.id,
                kind: story.kind as "event" | "document" | "media" | "thread",
                subtype: story.subtype,
                revisionId: story.currentRevision.id,
                title: story.currentRevision.title,
                summary: story.currentRevision.summary,
                status: shellReplacements.length > 0 ? "split" : "active",
                replacedBy: shellReplacements.map((replacement) => ({
                    storyId: replacement.successorStoryId,
                    title: replacement.successor.currentRevision?.title
                        ?? replacement.successorStoryId,
                    kind: replacement.successor.kind as "event" | "document" | "media" | "thread",
                })),
            },
            entry: entries[0] ?? null,
            entries,
            topics: topicMemberships.map((membership) => ({
                topicId: membership.topicId,
                title: membership.topic.currentRevision?.title ?? membership.topicId,
                role: membership.currentRevision?.role ?? "core",
            })),
            entities,
            labels: labelAssignments.map((assignment) => ({
                id: assignment.label.id,
                name: assignment.label.name,
            })),
            favorited: favorite !== null,
            evidence: evidenceLinks.map((link) => ({
                entryId: link.entryId,
                sourceId: link.entry.sourceInstance.id,
                sourceName: link.entry.sourceInstance.name,
                relationType: link.relationType,
                title: link.entry.currentRevision?.title ?? null,
                producer: link.producer,
                producerVersion: link.producerVersion,
                confidence: link.confidence,
                evidence: link.evidence,
                actor: link.actorJson == null ? null : parseJson<string>(link.actorJson),
                reason: link.reason,
            })),
        };
    }

    protected async resolveCanonicalTopicId(topicId: string): Promise<string | null> {
        const alias = await this.prisma.topicAlias.findUnique({
            where: { id: topicId },
            select: { canonicalTopicId: true },
        });
        if (alias) {
            return alias.canonicalTopicId;
        }
        const topic = await this.prisma.topic.findUnique({
            where: { id: topicId },
            select: { id: true },
        });
        return topic?.id ?? null;
    }

    protected async toTopicDetail(topicId: string): Promise<TopicDetail | null> {
        const topic = await this.prisma.topic.findUnique({
            where: { id: topicId },
            include: {
                currentRevision: true,
                memberships: {
                    include: { currentRevision: true },
                },
            },
        });
        if (!topic || !topic.currentRevision) {
            return null;
        }
        const members = topic.memberships
            .filter((membership) => membership.currentRevision !== null)
            .map((membership) => ({
                storyId: membership.storyId,
                role: membership.currentRevision!.role,
                reason: membership.currentRevision!.reason,
                actor: membership.currentRevision!.actorJson == null
                    ? null
                    : parseJson<string>(membership.currentRevision!.actorJson),
                revision: membership.currentRevision!.revision,
                removed: membership.currentRevision!.tombstone,
            }));
        return {
            topic: {
                id: topic.id,
                revisionId: topic.currentRevision.id,
                title: topic.currentRevision.title,
                purpose: topic.currentRevision.purpose,
                scope: topic.currentRevision.scope,
            },
            members,
        };
    }

    protected async appendMembershipRevision(
        tx: Prisma.TransactionClient,
        input: {
            membershipId: string;
            role: string;
            reason: string | null;
            actor: string | null;
            tombstone: boolean;
        },
    ): Promise<void> {
        const latest = await tx.topicMembershipRevision.findFirst({
            where: { membershipId: input.membershipId },
            orderBy: { revision: "desc" },
            select: { revision: true },
        });
        const created = await tx.topicMembershipRevision.create({
            data: {
                membershipId: input.membershipId,
                revision: (latest?.revision ?? 0) + 1,
                role: input.role,
                reason: input.reason,
                actorJson: input.actor == null ? null : JSON.stringify(input.actor),
                tombstone: input.tombstone,
            },
        });
        await tx.topicMembership.update({
            where: { id: input.membershipId },
            data: { currentRevisionId: created.id },
        });
    }

    async topic(topicId: string): Promise<TopicDetail | null> {
        const canonicalId = await this.resolveCanonicalTopicId(topicId);
        if (!canonicalId) {
            return null;
        }
        return this.toTopicDetail(canonicalId);
    }

    async label(labelId: string): Promise<LabelDetail | null> {
        const label = await this.prisma.label.findUnique({
            where: { id: labelId },
        });
        if (!label) {
            return null;
        }
        const assignments = await this.prisma.labelAssignment.findMany({
            where: { labelId },
            orderBy: { createdAt: "asc" },
        });
        const group = (type: string) => assignments
            .filter((assignment) => assignment.targetType === type)
            .map((assignment) => assignment.targetId);
        const [storyIds, entryIds, topicIds] = [
            group("story"),
            group("entry"),
            group("topic"),
        ];
        const [stories, entries, topics] = await Promise.all([
            this.prisma.story.findMany({
                where: { id: { in: storyIds } },
                include: { currentRevision: { select: { title: true } } },
            }),
            this.prisma.entry.findMany({
                where: { id: { in: entryIds } },
                include: { currentRevision: { select: { title: true } } },
            }),
            this.prisma.topic.findMany({
                where: { id: { in: topicIds } },
                include: { currentRevision: { select: { title: true } } },
            }),
        ]);
        const storyTitles = new Map(stories.map((story) => [story.id, story.currentRevision?.title ?? ""]));
        const entryTitles = new Map(entries.map((entry) => [entry.id, entry.currentRevision?.title ?? ""]));
        const topicTitles = new Map(topics.map((topic) => [topic.id, topic.currentRevision?.title ?? ""]));
        return {
            id: label.id,
            name: label.name,
            createdAt: label.createdAt.toISOString(),
            updatedAt: label.updatedAt.toISOString(),
            assignedStories: storyIds.map((id) => ({ id, title: storyTitles.get(id) ?? "" })),
            assignedEntries: entryIds.map((id) => ({ id, title: entryTitles.get(id) ?? "" })),
            assignedTopics: topicIds.map((id) => ({ id, title: topicTitles.get(id) ?? "" })),
        };
    }

    async entry(entryId: string): Promise<EntryDetail | null> {
        const entry = await this.prisma.entry.findUnique({
            where: { id: entryId },
            include: {
                sourceInstance: true,
                currentRevision: {
                    include: { assets: true },
                },
                revisions: {
                    orderBy: { revision: "desc" },
                    include: { assets: true },
                },
                observations: {
                    orderBy: { capturedAt: "desc" },
                },
            },
        });
        if (!entry || !entry.currentRevision) {
            return null;
        }
        const entryLinks = await this.prisma.entryStoryLink.findMany({
            where: { entryId: entry.id },
            include: { story: { include: { currentRevision: { select: { title: true } } } } },
        });
        return {
            id: entry.id,
            sourceId: entry.sourceInstance.id,
            sourceName: entry.sourceInstance.name,
            sourceKind: sourceKindSchema.parse(entry.sourceInstance.kind),
            currentRevisionId: entry.currentRevision.id,
            metrics: parseJson<ContentMetrics>(entry.metricsJson),
            revisions: entry.revisions.map((revision) => ({
                id: revision.id,
                revision: revision.revision,
                title: revision.title,
                summary: revision.summary,
                contentText: revision.contentText,
                webUrl: revision.webUrl,
                contentKind: contentKindSchema.parse(revision.contentKind),
                publisher: parseJson<Publisher>(revision.publisherJson),
                publishedAt: parseJson<TemporalValue>(revision.publishedAtJson)
                    ?? exactTemporalValue(revision.sourcePublishedAt),
                updatedAt: parseJson<TemporalValue>(revision.updatedAtJson),
                sourcePublishedAt: revision.sourcePublishedAt?.toISOString() ?? null,
                createdAt: revision.createdAt.toISOString(),
                assets: revision.assets.map((asset) => this.toAssetSnapshot(asset)),
            })),
            observations: entry.observations.map((observation) => ({
                id: observation.id,
                externalId: observation.externalId,
                externalKey: observation.externalKey,
                eventKind: observation.eventKind as "create" | "update" | "delete" | "snapshot",
                webUrl: observation.webUrl,
                capturedAt: observation.capturedAt.toISOString(),
                sourcePublishedAt: observation.sourcePublishedAt?.toISOString() ?? null,
            })),
            relatedStories: entryLinks.map((link) => ({
                storyId: link.storyId,
                relationType: link.relationType,
                title: link.story.currentRevision?.title ?? link.storyId,
                reason: link.reason,
            })),
        };
    }

    async revision(revisionId: string): Promise<RevisionDetail | null> {
        const revision = await this.prisma.entryRevision.findUnique({
            where: { id: revisionId },
            include: {
                entry: {
                    include: {
                        sourceInstance: true,
                    },
                },
                assets: true,
            },
        });
        if (!revision) {
            return null;
        }
        return {
            id: revision.id,
            entryId: revision.entryId,
            sourceId: revision.entry.sourceInstance.id,
            sourceName: revision.entry.sourceInstance.name,
            sourceKind: sourceKindSchema.parse(revision.entry.sourceInstance.kind),
            revision: revision.revision,
            title: revision.title,
            summary: revision.summary,
            contentText: revision.contentText,
            webUrl: revision.webUrl,
            contentKind: contentKindSchema.parse(revision.contentKind),
            publisher: parseJson<Publisher>(revision.publisherJson),
            publishedAt: parseJson<TemporalValue>(revision.publishedAtJson)
                ?? exactTemporalValue(revision.sourcePublishedAt),
            updatedAt: parseJson<TemporalValue>(revision.updatedAtJson),
            sourcePublishedAt: revision.sourcePublishedAt?.toISOString() ?? null,
            createdAt: revision.createdAt.toISOString(),
            assets: revision.assets.map((asset) => this.toAssetSnapshot(asset)),
        };
    }

}
