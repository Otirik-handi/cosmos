import type { AssetErrorCode } from "@cosmos/contracts";
import type { NormalizedIngestItem } from "@cosmos/domain";
import type { LoggerPort } from "./logger.js";
import type { MediaAcquisitionLimits, MediaPolicy } from "./media-policy.js";

export type HostResolver = (host: string) => Promise<readonly string[]>;

export interface MediaAcquirerOptions {
    fetch?: typeof globalThis.fetch;
    limits?: Partial<MediaAcquisitionLimits>;
    /** Test seam: default resolves via node:dns. */
    resolveHost?: HostResolver;
    /** Explicit opt-in hosts (COSMOS_MEDIA_ALLOWED_HOSTS); bypasses the private-range block. */
    allowedHosts?: readonly string[];
    maxRedirects?: number;
    logger?: LoggerPort;
}

export interface MediaAcquisitionContext {
    signal?: AbortSignal;
    /** Per-run policy from the Run's source snapshot; omitted = global defaults. */
    policy?: MediaPolicy;
}

export interface MediaAcquirer {
    acquireItems(
        items: readonly NormalizedIngestItem[],
        context?: MediaAcquisitionContext,
    ): Promise<readonly NormalizedIngestItem[]>;
}

/** A stored degraded Asset the retry step may attempt again (ADR-0015 decision 1). */
export interface MediaRetryCandidate {
    assetId: string;
    sourceUrl: string;
    kind: string;
    mimeType: string | null;
    /** Attempts already recorded; the write path uses it as CAS (ADR-0015 decision 4). */
    attemptCount: number;
}

export type MediaRetryOutcome =
    | {
        assetId: string;
        status: "saved";
        content: Uint8Array;
        mimeType: string;
    }
    | {
        assetId: string;
        status: "failed" | "skipped";
        errorCode: AssetErrorCode;
        errorMessage: string;
    };

export interface MediaRetryContext extends MediaAcquisitionContext {
    /** Remaining per-run budget after the page's own media (ADR-0015 decision 5). */
    budgetBytes?: number;
}

export interface MediaRetrier {
    retryAssets(
        candidates: readonly MediaRetryCandidate[],
        context?: MediaRetryContext,
    ): Promise<readonly MediaRetryOutcome[]>;
}

export type SavedMedia = {
    status: "saved";
    bytes: Uint8Array;
    mimeType: string;
};

export type DegradedMedia = {
    status: "skipped" | "failed";
    errorMessage: string;
    /** Machine-readable reason; retry decisions read only this (ADR-0015). */
    errorCode: AssetErrorCode;
};

export type MediaOutcome = SavedMedia | DegradedMedia;
