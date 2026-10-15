import type { Prisma } from "@prisma/client";
import { StoryNotFoundError, StoryRevisionConflictError } from "@cosmos/application";
import { fingerprintStoryRevision, normalizeStoryRepresentation, type StoryKind, type StoryKeyFact, type StoryTimeRange } from "@cosmos/domain";
import { appendDomainEvent, assertStorySubtype } from "./repository-internals.js";

export interface StoryRevisionCommand {
    storyId: string;
    baseRevisionId: string;
    title: string;
    summary: string | null;
    kind: StoryKind;
    subtype: string | null;
    timeRange?: StoryTimeRange | null;
    keyFacts?: readonly StoryKeyFact[] | null;
    actor?: string | null;
    reason?: string | null;
}

/** Candidate decisions use this command inside their own transaction. */
export async function writeStoryRevision(tx: Prisma.TransactionClient, input: StoryRevisionCommand): Promise<void> {
    const story = await tx.story.findUnique({ where: { id: input.storyId }, include: { currentRevision: true } });
    if (!story) throw new StoryNotFoundError(input.storyId);
    if (!story.currentRevision || story.currentRevision.id !== input.baseRevisionId) {
        throw new StoryRevisionConflictError(input.storyId);
    }
    // Existing unregistered subtypes remain editable; new assignments require registration.
    if (input.kind !== story.kind || input.subtype !== story.subtype) assertStorySubtype(input.kind, input.subtype);
    const representation = normalizeStoryRepresentation(input);
    const fingerprint = fingerprintStoryRevision({
        title: input.title, summary: input.summary, kind: input.kind, subtype: input.subtype,
        timeRange: representation.timeRange, keyFacts: representation.keyFacts,
    });
    if (story.currentRevision.fingerprint === fingerprint) return;
    const latest = await tx.storyRevision.findFirst({
        where: { storyId: input.storyId }, orderBy: { revision: "desc" }, select: { revision: true },
    });
    const created = await tx.storyRevision.create({ data: {
        story: { connect: { id: input.storyId } }, revision: (latest?.revision ?? 0) + 1,
        fingerprint, producer: "human", actorJson: input.actor == null ? null : JSON.stringify(input.actor),
        reason: input.reason ?? null, title: input.title, summary: input.summary,
        timeRangeJson: representation.timeRange ? JSON.stringify(representation.timeRange) : null,
        keyFactsJson: representation.keyFacts.length ? JSON.stringify(representation.keyFacts) : null,
    } });
    // A stale candidate cannot replace a revision edited after its input snapshot.
    const updated = await tx.story.updateMany({
        where: { id: input.storyId, currentRevisionId: input.baseRevisionId },
        data: { currentRevisionId: created.id, kind: input.kind, subtype: input.subtype },
    });
    if (updated.count !== 1) throw new StoryRevisionConflictError(input.storyId);
    await appendDomainEvent(tx, {
        type: "story.revision_created.v1", aggregateType: "Story", aggregateId: input.storyId,
        payload: { storyId: input.storyId, baseRevisionId: input.baseRevisionId, revision: created.revision,
            actor: input.actor ?? null, reason: input.reason ?? null },
    });
}
