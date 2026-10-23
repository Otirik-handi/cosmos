import { z } from "zod";

import {
    providerModelDiscoveryCandidateSchema,
    type ProviderModelDiscoveryCandidate,
    type ProviderModelDiscoveryErrorCode,
} from "@cosmos/contracts";

/** 发现只接受 OpenAI 兼容目录条目：其它字段一律丢弃，避免把上游任意内容带进产品面。 */
const upstreamEntrySchema = z.object({
    id: z.string(),
    name: z.string().optional(),
}).passthrough();

const upstreamListingSchema = z.object({
    data: z.array(z.unknown()),
}).passthrough();

export type ProviderModelCatalogResult =
    | { ok: true; candidates: ProviderModelDiscoveryCandidate[] }
    | { ok: false; errorCode: ProviderModelDiscoveryErrorCode };

export const providerModelCatalogLimits = {
    maxCandidates: 1000,
    maxResponseBytes: 1024 * 1024,
} as const;

function toCandidate(entry: z.infer<typeof upstreamEntrySchema>): ProviderModelDiscoveryCandidate | null {
    const modelId = entry.id.trim();
    if (!modelId) return null;
    const name = entry.name?.trim() || modelId;
    const parsed = providerModelDiscoveryCandidateSchema.safeParse({ modelId, name });
    return parsed.success ? parsed.data : null;
}

/**
 * 把上游 `/models` 响应体收敛成候选列表。响应体已经由 transport 限制在
 * `maxResponseBytes` 内，这里只负责结构、去重与数量上限。
 */
export function parseProviderModelCatalog(body: unknown): ProviderModelCatalogResult {
    const listing = upstreamListingSchema.safeParse(body);
    if (!listing.success) return { ok: false, errorCode: "malformed_response" };

    const candidates: ProviderModelDiscoveryCandidate[] = [];
    const seen = new Set<string>();
    for (const raw of listing.data.data) {
        const entry = upstreamEntrySchema.safeParse(raw);
        if (!entry.success) continue;
        const candidate = toCandidate(entry.data);
        if (!candidate || seen.has(candidate.modelId)) continue;
        seen.add(candidate.modelId);
        candidates.push(candidate);
        if (candidates.length > providerModelCatalogLimits.maxCandidates) {
            return { ok: false, errorCode: "response_too_large" };
        }
    }

    if (candidates.length === 0) return { ok: false, errorCode: "empty_result" };
    return { ok: true, candidates };
}
