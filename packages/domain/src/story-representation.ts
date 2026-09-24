import { hashValue } from "./internal.js";
import type { StoryKind } from "./story-subtypes.js";
import type { TemporalValue } from "./temporal.js";

export interface StoryTimeRange {
    start: TemporalValue;
    end: TemporalValue | null;
}

export interface StoryKeyFact {
    text: string;
    entryId: string | null;
}

// Ceilings for the Story representation extension (ADR-0021 decision 3); the
// contracts package reuses them so the write boundary and the domain agree.
export const storyKeyFactMaxCount = 20;

export const storyKeyFactMaxTextLength = 500;

export interface StoryRepresentationExtension {
    timeRange?: StoryTimeRange | null;
    keyFacts?: readonly StoryKeyFact[] | null;
}

export interface StoryRevisionContent extends StoryRepresentationExtension {
    title: string;
    summary: string | null;
    kind: StoryKind;
    subtype: string | null;
}

export interface NormalizedStoryRepresentation {
    timeRange: StoryTimeRange | null;
    keyFacts: StoryKeyFact[];
}

/**
 * Single normalization shared by the Story fingerprint and persistence, so the
 * two never disagree about whether a submission is a no-op (ADR-0021 decision 4).
 */
export function normalizeStoryRepresentation(
    input: StoryRepresentationExtension,
): NormalizedStoryRepresentation {
    return {
        timeRange: normalizeStoryTimeRange(input.timeRange),
        keyFacts: normalizeStoryKeyFacts(input.keyFacts),
    };
}

function normalizeStoryTimeRange(
    value: StoryTimeRange | null | undefined,
): StoryTimeRange | null {
    if (!value) {
        return null;
    }
    const start = normalizeTemporalValue(value.start);
    // `start` is the required anchor of the shape: a range whose start cannot be
    // represented is undetermined, and a lone `end` is not expressible.
    if (!start) {
        return null;
    }
    return { start, end: value.end ? normalizeTemporalValue(value.end) : null };
}

function normalizeTemporalValue(value: TemporalValue): TemporalValue | null {
    const exact = value.exact?.trim() ?? "";
    const fallback = value.fallback
        ? {
            raw: value.fallback.raw.trim(),
            lowerBound: value.fallback.lowerBound.trim(),
            precision: value.fallback.precision,
            timezone: value.fallback.timezone?.trim() || null,
            confidence: value.fallback.confidence,
        }
        : null;
    if (!exact && !fallback) {
        return null;
    }
    return {
        exact: exact || null,
        exactPrecision: exact ? value.exactPrecision : null,
        fallback,
    };
}

function normalizeStoryKeyFacts(
    value: readonly StoryKeyFact[] | null | undefined,
): StoryKeyFact[] {
    if (!value) {
        return [];
    }
    const facts: StoryKeyFact[] = [];
    for (const fact of value) {
        const text = fact.text.trim();
        if (!text) {
            continue;
        }
        facts.push({ text, entryId: fact.entryId?.trim() || null });
    }
    return facts;
}

/**
 * Story revision fingerprint covers the user-visible display fields only.
 * Changes that do not alter any of these fields are no-ops and must not
 * append a new StoryRevision (ADR-0006 decision 3).
 *
 * ADR-0021 decision 4: the four base fields are hashed exactly as before and an
 * empty extension is omitted from the digest input, so a Story that predates
 * timeRange/keyFacts keeps its stored fingerprint and stays a no-op. Key
 * insertion order below is load-bearing.
 */
export function fingerprintStoryRevision(input: StoryRevisionContent): string {
    const representation = normalizeStoryRepresentation(input);
    const digestInput: Record<string, unknown> = {
        title: input.title,
        summary: input.summary,
        kind: input.kind,
        subtype: input.subtype,
    };
    if (representation.timeRange) {
        digestInput.timeRange = representation.timeRange;
    }
    if (representation.keyFacts.length > 0) {
        digestInput.keyFacts = representation.keyFacts;
    }
    return hashValue(JSON.stringify(digestInput));
}
