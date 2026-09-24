import { hashValue } from "./internal.js";
import type { EntityType } from "./enums.js";

export interface TopicRevisionContent {
    title: string;
    purpose: string;
    scope: string | null;
}

/**
 * Topic revision fingerprint covers the user-visible display fields only.
 * Changes that do not alter any of these fields are no-ops and must not
 * append a new TopicRevision (ADR-0007 decision 1).
 */
export function fingerprintTopicRevision(input: TopicRevisionContent): string {
    return hashValue(JSON.stringify({
        title: input.title,
        purpose: input.purpose,
        scope: input.scope,
    }));
}

export interface EntityRevisionContent {
    name: string;
    type: EntityType;
}

/**
 * Entity revision fingerprint covers the user-visible identity fields only.
 * Changes that do not alter either field are no-ops and must not append a
 * new EntityRevision (ADR-0008 decision 2).
 */
export function fingerprintEntityRevision(input: EntityRevisionContent): string {
    return hashValue(JSON.stringify({
        name: input.name,
        type: input.type,
    }));
}
