import { mediaPolicyCeilings, mediaRetryCeiling } from "@cosmos/contracts";
import type { SourceMediaPolicy } from "@cosmos/contracts";

/**
 * Application-owned media acquisition (ADR-0005). The connector only extracts
 * candidates; this module performs the bounded image download, security checks
 * and per-run byte budget in one reviewed place. It never touches the Blob
 * Root: saved bytes are handed back as domain Uint8Array and the existing
 * toJsonItem/persist chain writes them.
 */
export const mediaDownloadCapability = "media-download";

export const mediaAcquisitionDefaults = {
    maxFileBytes: mediaPolicyCeilings.maxFileBytes,
    maxRunBytes: mediaPolicyCeilings.maxRunBytes,
    perMediaTimeoutMs: 60_000,
} as const;

/** Retry attempt ceiling default; counts the first download too (ADR-0015). */
export const mediaRetryDefaults = {
    maxAttempts: 3,
} as const;

export interface MediaAcquisitionLimits {
    maxFileBytes: number;
    maxRunBytes: number;
    perMediaTimeoutMs: number;
}

/** Effective per-run policy: source values already tightened to the ceilings. */
export interface MediaPolicy {
    images: "download" | "metadata_only";
    maxFileBytes: number;
    maxRunBytes: number;
    retry: {
        maxAttempts: number;
    };
}

/**
 * Resolve a plan's optional `mediaPolicy` into effective values. Missing
 * fields follow the global defaults, and both byte limits are capped by them
 * so a stored value that bypassed the contract cannot raise the budget
 * (ADR-0014 decision 2).
 */
export function resolveMediaPolicy(
    policy: SourceMediaPolicy | null | undefined,
    limits: MediaAcquisitionLimits = mediaAcquisitionDefaults,
): MediaPolicy {
    return {
        images: policy?.images ?? "download",
        maxFileBytes: Math.min(policy?.maxFileBytes ?? limits.maxFileBytes, limits.maxFileBytes),
        maxRunBytes: Math.min(policy?.maxRunBytes ?? limits.maxRunBytes, limits.maxRunBytes),
        retry: {
            maxAttempts: Math.min(
                policy?.retry?.maxAttempts ?? mediaRetryDefaults.maxAttempts,
                mediaRetryCeiling,
            ),
        },
    };
}

export function parseAllowedHosts(value: string | undefined | null): string[] {
    if (!value) {
        return [];
    }
    return [...new Set(
        value
            .split(/[\s,]+/)
            .map((entry) => entry.trim().toLowerCase())
            .filter(Boolean),
    )];
}
