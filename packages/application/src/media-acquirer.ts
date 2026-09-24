import type { AssetErrorCode } from "@cosmos/contracts";
import type { NormalizedAssetInput, NormalizedIngestItem } from "@cosmos/domain";
import type { LoggerPort } from "./logger.js";
import { acquireImageCandidate, defaultResolveHost } from "./media-download.js";
import { mediaAcquisitionDefaults, parseAllowedHosts } from "./media-policy.js";
import type { AcquisitionDeps } from "./media-download.js";
import type { MediaAcquisitionLimits, MediaPolicy } from "./media-policy.js";
import type { MediaAcquirer, MediaAcquirerOptions, MediaAcquisitionContext, MediaOutcome, MediaRetrier, MediaRetryOutcome } from "./media-ports.js";

/**
 * Acquire media only for items that will persist a new/revised Entry.
 * Items whose content fingerprint is unchanged stay as the connector returned
 * them (assets remain metadata_only); the persist duplicate path writes no
 * Asset rows, so downloading those candidates would be pure side effect.
 */
export async function acquireItemsSkippingUnchanged(
    acquirer: MediaAcquirer,
    items: readonly NormalizedIngestItem[],
    unchanged: readonly boolean[],
    context?: MediaAcquisitionContext,
): Promise<readonly NormalizedIngestItem[]> {
    if (items.length !== unchanged.length) {
        throw new Error("Media preflight length must match the fetched item list.");
    }
    const acquireIndexes = unchanged.flatMap((skip, index) => skip ? [] : [index]);
    if (acquireIndexes.length === 0) {
        return items;
    }
    const acquired = await acquirer.acquireItems(
        acquireIndexes.map((index) => items[index]),
        context,
    );
    if (acquired.length !== acquireIndexes.length) {
        throw new Error("Media acquirer returned a different item count than requested.");
    }
    const merged = [...items];
    acquireIndexes.forEach((index, position) => {
        merged[index] = acquired[position];
    });
    return merged;
}

export function createMediaAcquirer(options: MediaAcquirerOptions = {}): MediaAcquirer & MediaRetrier {
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const limits: MediaAcquisitionLimits = {
        ...mediaAcquisitionDefaults,
        ...options.limits,
    };
    const resolveHost = options.resolveHost ?? defaultResolveHost;
    const maxRedirects = options.maxRedirects ?? 3;
    const allowed = new Set(parseAllowedHosts(
        options.allowedHosts?.join(",") ?? "",
    ));

    function effectiveLimitsFor(policy: MediaPolicy | undefined): MediaAcquisitionLimits {
        return policy
            ? {
                ...limits,
                // Clamp against this acquirer's own limits too, so a
                // configured (or test) ceiling is never raised by a source.
                maxFileBytes: Math.min(policy.maxFileBytes, limits.maxFileBytes),
                maxRunBytes: Math.min(policy.maxRunBytes, limits.maxRunBytes),
            }
            : limits;
    }

    return {
        async acquireItems(items, context) {
            const policy = context?.policy;
            if (policy?.images === "metadata_only") {
                // Policy off: keep the connector's metadata_only output as-is
                // instead of rewriting status (ADR-0014 decision 3).
                return items;
            }
            const effectiveLimits = effectiveLimitsFor(policy);
            const startedAt = Date.now();
            const state = {
                runBytes: 0,
                savedCount: 0,
                skippedCount: 0,
                failedCount: 0,
            };
            const memo = new Map<string, MediaOutcome>();
            const signal = context?.signal;

            const rewritten = [];
            for (const item of items) {
                rewritten.push(await rewriteAssets(item, {
                    fetch: fetchImpl,
                    limits: effectiveLimits,
                    resolveHost,
                    allowed,
                    maxRedirects,
                    signal,
                    logger: options.logger,
                    state,
                    memo,
                }));
            }

            options.logger?.info("media.acquire.completed", {
                durationMs: Date.now() - startedAt,
                images: policy?.images ?? "download",
                maxFileBytes: effectiveLimits.maxFileBytes,
                maxRunBytes: effectiveLimits.maxRunBytes,
                runBytes: state.runBytes,
                savedCount: state.savedCount,
                skippedCount: state.skippedCount,
                failedCount: state.failedCount,
            });
            return rewritten;
        },
        async retryAssets(candidates, context) {
            const policy = context?.policy;
            if (policy?.images === "metadata_only" || candidates.length === 0) {
                return [];
            }
            const effectiveLimits = effectiveLimitsFor(policy);
            // Retries share the page's remaining budget instead of opening a
            // second full one (ADR-0015 decision 5).
            const budget = Math.max(
                0,
                Math.min(
                    context?.budgetBytes ?? effectiveLimits.maxRunBytes,
                    effectiveLimits.maxRunBytes,
                ),
            );
            const startedAt = Date.now();
            const state = {
                runBytes: 0,
                savedCount: 0,
                skippedCount: 0,
                failedCount: 0,
            };
            const memo = new Map<string, MediaOutcome>();
            const outcomes: MediaRetryOutcome[] = [];
            for (const candidate of candidates) {
                const placeholder: NormalizedAssetInput = {
                    kind: candidate.kind,
                    sourceUrl: candidate.sourceUrl,
                    status: "failed",
                    mimeType: candidate.mimeType,
                    byteSize: null,
                    content: null,
                };
                const memoHit = memo.get(candidate.sourceUrl);
                const outcome = memoHit ?? await acquireImageCandidate(placeholder, {
                    fetch: fetchImpl,
                    limits: { ...effectiveLimits, maxRunBytes: budget },
                    resolveHost,
                    allowed,
                    maxRedirects,
                    signal: context?.signal,
                    logger: options.logger,
                    state,
                    memo,
                });
                if (!memoHit) {
                    memo.set(candidate.sourceUrl, outcome);
                    if (outcome.status === "saved") {
                        state.savedCount += 1;
                        state.runBytes += outcome.bytes.byteLength;
                    } else if (outcome.status === "skipped") {
                        state.skippedCount += 1;
                    } else {
                        state.failedCount += 1;
                    }
                }
                outcomes.push(outcome.status === "saved"
                    ? {
                        assetId: candidate.assetId,
                        status: "saved",
                        content: outcome.bytes,
                        mimeType: outcome.mimeType,
                    }
                    : {
                        assetId: candidate.assetId,
                        status: outcome.status,
                        errorCode: outcome.errorCode,
                        errorMessage: outcome.errorMessage,
                    });
            }
            options.logger?.info("media.retry.completed", {
                durationMs: Date.now() - startedAt,
                candidateCount: candidates.length,
                budgetBytes: budget,
                runBytes: state.runBytes,
                savedCount: state.savedCount,
                skippedCount: state.skippedCount,
                failedCount: state.failedCount,
            });
            return outcomes;
        },
    };
}

export async function rewriteAssets(
    item: NormalizedIngestItem,
    deps: AcquisitionDeps,
): Promise<NormalizedIngestItem> {
    if (item.assets.length === 0) {
        return item;
    }
    const assets: NormalizedAssetInput[] = [];
    for (const asset of item.assets) {
        if (!isImageDownloadCandidate(asset)) {
            assets.push(asset);
            continue;
        }
        const key = asset.sourceUrl ?? "";
        const memoHit = key ? deps.memo.get(key) : undefined;
        let outcome = memoHit;
        let computed = false;
        if (!outcome) {
            outcome = await acquireImageCandidate(asset, deps);
            computed = true;
            if (key) {
                deps.memo.set(key, outcome);
            }
        }
        if (outcome.status === "saved") {
            assets.push({
                ...asset,
                status: "saved",
                content: outcome.bytes,
                mimeType: outcome.mimeType,
                byteSize: outcome.bytes.byteLength,
                errorMessage: null,
                errorCode: null,
                attemptCount: 1,
            });
            if (computed) {
                deps.state.savedCount += 1;
                deps.state.runBytes += outcome.bytes.byteLength;
            }
        } else {
            assets.push({
                ...asset,
                status: outcome.status,
                content: null,
                errorMessage: outcome.errorMessage,
                errorCode: outcome.errorCode,
                attemptCount: 1,
            });
            if (computed) {
                if (outcome.status === "skipped") {
                    deps.state.skippedCount += 1;
                } else {
                    deps.state.failedCount += 1;
                }
            }
        }
    }
    return { ...item, assets };
}

export function isImageDownloadCandidate(asset: NormalizedAssetInput): boolean {
    if (!asset.sourceUrl) {
        return false;
    }
    if (asset.kind === "image") {
        return true;
    }
    return asset.kind === "enclosure"
        && (asset.mimeType ?? "").toLowerCase().startsWith("image/");
}
