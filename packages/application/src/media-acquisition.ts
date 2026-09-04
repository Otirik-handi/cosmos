import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import type {
    NormalizedAssetInput,
    NormalizedIngestItem,
} from "@cosmos/domain";
import type { LoggerPort } from "./index.js";

/**
 * Application-owned media acquisition (ADR-0005). The connector only extracts
 * candidates; this module performs the bounded image download, security checks
 * and per-run byte budget in one reviewed place. It never touches the Blob
 * Root: saved bytes are handed back as domain Uint8Array and the existing
 * toJsonItem/persist chain writes them.
 */
export const mediaDownloadCapability = "media-download";

export const mediaAcquisitionDefaults = {
    maxFileBytes: 10 * 1024 * 1024,
    maxRunBytes: 50 * 1024 * 1024,
    perMediaTimeoutMs: 60_000,
} as const;

export interface MediaAcquisitionLimits {
    maxFileBytes: number;
    maxRunBytes: number;
    perMediaTimeoutMs: number;
}

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

export interface MediaAcquirer {
    acquireItems(
        items: readonly NormalizedIngestItem[],
        context?: { signal?: AbortSignal },
    ): Promise<readonly NormalizedIngestItem[]>;
}

type SavedMedia = {
    status: "saved";
    bytes: Uint8Array;
    mimeType: string;
};

type DegradedMedia = {
    status: "skipped" | "failed";
    errorMessage: string;
};

type MediaOutcome = SavedMedia | DegradedMedia;

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

export function createMediaAcquirer(options: MediaAcquirerOptions = {}): MediaAcquirer {
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

    return {
        async acquireItems(items, context) {
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
                    limits,
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
                runBytes: state.runBytes,
                savedCount: state.savedCount,
                skippedCount: state.skippedCount,
                failedCount: state.failedCount,
            });
            return rewritten;
        },
    };
}

async function rewriteAssets(
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

function isImageDownloadCandidate(asset: NormalizedAssetInput): boolean {
    if (!asset.sourceUrl) {
        return false;
    }
    if (asset.kind === "image") {
        return true;
    }
    return asset.kind === "enclosure"
        && (asset.mimeType ?? "").toLowerCase().startsWith("image/");
}

interface AcquisitionDeps {
    fetch: typeof globalThis.fetch;
    limits: MediaAcquisitionLimits;
    resolveHost: HostResolver;
    allowed: Set<string>;
    maxRedirects: number;
    signal?: AbortSignal;
    logger?: LoggerPort;
    state: {
        runBytes: number;
        savedCount: number;
        skippedCount: number;
        failedCount: number;
    };
    memo: Map<string, MediaOutcome>;
}

async function acquireImageCandidate(
    asset: NormalizedAssetInput,
    deps: AcquisitionDeps,
): Promise<MediaOutcome> {
    const sourceUrl = asset.sourceUrl ?? "";
    const logger = deps.logger;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, deps.limits.perMediaTimeoutMs);
    if (typeof timer.unref === "function") {
        timer.unref();
    }
    const onOuterAbort = (): void => {
        controller.abort();
    };
    if (deps.signal) {
        if (deps.signal.aborted) {
            clearTimeout(timer);
            throw new Error("media.acquire.cancelled");
        }
        deps.signal.addEventListener("abort", onOuterAbort, { once: true });
    }

    const host = describeHost(sourceUrl);
    let result: MediaOutcome;
    try {
        const url = checkUrl(sourceUrl, deps);
        if ("errorMessage" in url) {
            result = url;
        } else {
            const blocked = await checkHostAllowed(url.hostname, deps);
            if ("errorMessage" in blocked) {
                result = blocked;
            } else {
                result = await downloadWithRedirects(url, deps, controller);
            }
        }
    } catch (error) {
        if (deps.signal?.aborted) {
            throw error;
        }
        result = {
            status: "failed",
            errorMessage: timedOut ? "图片下载超时" : "图片下载失败",
        };
    } finally {
        clearTimeout(timer);
        if (deps.signal) {
            deps.signal.removeEventListener("abort", onOuterAbort);
        }
    }

    logger?.debug("media.acquire.asset", {
        kind: "image",
        host,
        status: result.status,
        ...(result.status !== "saved" ? { errorMessage: result.errorMessage } : {}),
        ...(result.status === "saved" ? { byteSize: result.bytes.byteLength } : {}),
    });
    return result;
}

function checkUrl(
    sourceUrl: string,
    deps: AcquisitionDeps,
): URL | DegradedMedia {
    let parsed: URL;
    try {
        parsed = new URL(sourceUrl);
    } catch {
        return {
            status: "skipped",
            errorMessage: "图片地址无法解析",
        };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return {
            status: "skipped",
            errorMessage: "图片地址协议不允许",
        };
    }
    if (parsed.username || parsed.password) {
        return {
            status: "skipped",
            errorMessage: "图片地址不允许包含账号信息",
        };
    }
    return parsed;
}

async function checkHostAllowed(
    hostname: string,
    deps: AcquisitionDeps,
): Promise<{ ok: true } | DegradedMedia> {
    const host = hostname.toLowerCase();
    if (deps.allowed.has(host) || deps.allowed.has(`.${host}`)) {
        return { ok: true };
    }
    let addresses: readonly string[];
    try {
        addresses = await deps.resolveHost(host);
    } catch {
        return {
            status: "failed",
            errorMessage: "无法解析图片服务器地址",
        };
    }
    if (addresses.length === 0) {
        return {
            status: "failed",
            errorMessage: "无法解析图片服务器地址",
        };
    }
    const blocked = addresses.find((address) => !isPublicAddress(address));
    if (blocked) {
        return {
            status: "skipped",
            errorMessage: "图片服务器位于内网或本机地址，已拦截",
        };
    }
    return { ok: true };
}

async function downloadWithRedirects(
    start: URL,
    deps: AcquisitionDeps,
    controller: AbortController,
): Promise<MediaOutcome> {
    let current = start;
    for (let hop = 0; hop <= deps.maxRedirects; hop += 1) {
        const response = await deps.fetch(current.href, {
            redirect: "manual",
            signal: controller.signal,
            headers: {
                accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            },
        });
        if (isRedirect(response.status)) {
            const location = response.headers.get("location");
            if (hop >= deps.maxRedirects || !location) {
                return {
                    status: "failed",
                    errorMessage: "图片重定向次数过多或缺少目标",
                };
            }
            const next = checkUrl(new URL(location, current).href, deps);
            if ("errorMessage" in next) {
                return next;
            }
            const blocked = await checkHostAllowed(next.hostname, deps);
            if ("errorMessage" in blocked) {
                return blocked;
            }
            current = next;
            continue;
        }
        if (!response.ok) {
            return {
                status: "failed",
                errorMessage: `图片下载失败（HTTP ${response.status}）`,
            };
        }
        return consumeImageBody(response, deps, controller);
    }
    return {
        status: "failed",
        errorMessage: "图片重定向次数过多",
    };
}

async function consumeImageBody(
    response: Response,
    deps: AcquisitionDeps,
    controller: AbortController,
): Promise<MediaOutcome> {
    const remaining = deps.limits.maxRunBytes - deps.state.runBytes;
    if (remaining <= 0) {
        return {
            status: "skipped",
            errorMessage: "单次运行媒体预算已用尽",
        };
    }
    const fileCap = Math.min(deps.limits.maxFileBytes, remaining);
    const declaredLength = Number.parseInt(
        response.headers.get("content-length") ?? "",
        10,
    );
    if (Number.isFinite(declaredLength) && declaredLength > fileCap) {
        return {
            status: "skipped",
            errorMessage: declaredLength > deps.limits.maxFileBytes
                ? "图片超过单文件大小上限（10MB）"
                : "图片超出单次运行剩余预算",
        };
    }

    const mime = parseContentType(response.headers.get("content-type"));
    const needsSniff = mime === null || mime === "application/octet-stream";
    if (!needsSniff && !mime.startsWith("image/")) {
        return {
            status: "failed",
            errorMessage: "图片下载内容不是图片类型",
        };
    }

    if (!response.body) {
        return {
            status: "failed",
            errorMessage: "图片响应没有内容",
        };
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        size += value.byteLength;
        if (size > fileCap) {
            await reader.cancel().catch(() => undefined);
            return {
                status: "skipped",
                errorMessage: fileCap === deps.limits.maxFileBytes
                    ? "图片超过单文件大小上限（10MB）"
                    : "图片超出单次运行剩余预算",
            };
        }
        chunks.push(value);
    }
    const bytes = concatBytes(chunks, size);
    if (bytes.length === 0) {
        return {
            status: "failed",
            errorMessage: "图片响应没有内容",
        };
    }

    let storedMime = mime;
    if (needsSniff) {
        const sniffed = sniffImageMime(bytes);
        if (!sniffed) {
            return {
                status: "failed",
                errorMessage: "图片下载内容不是图片类型",
            };
        }
        storedMime = sniffed;
    }
    return {
        status: "saved",
        bytes,
        mimeType: storedMime ?? "application/octet-stream",
    };
}

function isRedirect(status: number): boolean {
    return status === 301 || status === 302 || status === 303
        || status === 307 || status === 308;
}

function parseContentType(value: string | null): string | null {
    if (!value) {
        return null;
    }
    const raw = value.split(";", 1)[0].trim().toLowerCase();
    return raw || null;
}

function sniffImageMime(bytes: Uint8Array): string | null {
    if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
        return "image/png";
    }
    if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) {
        return "image/jpeg";
    }
    if (hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61])
        || hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) {
        return "image/gif";
    }
    if (bytes.length >= 12
        && ascii(bytes, 0, 4) === "RIFF"
        && ascii(bytes, 8, 4) === "WEBP") {
        return "image/webp";
    }
    return null;
}

function hasPrefix(bytes: Uint8Array, prefix: number[]): boolean {
    if (bytes.length < prefix.length) {
        return false;
    }
    for (let index = 0; index < prefix.length; index += 1) {
        if (bytes[index] !== prefix[index]) {
            return false;
        }
    }
    return true;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
    let value = "";
    for (let index = offset; index < offset + length; index += 1) {
        value += String.fromCharCode(bytes[index]);
    }
    return value;
}

function concatBytes(chunks: Uint8Array[], size: number): Uint8Array {
    const out = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return out;
}

function describeHost(sourceUrl: string): string | null {
    try {
        return new URL(sourceUrl).host;
    } catch {
        return null;
    }
}

async function defaultResolveHost(host: string): Promise<readonly string[]> {
    if (isIP(host)) {
        return [host];
    }
    const result = await lookup(host, { all: true, verbatim: true });
    return result.map((entry) => entry.address);
}

/** True only for global-unicast addresses reachable from a public network. */
export function isPublicAddress(address: string): boolean {
    if (isIP(address) === 4) {
        return isPublicIpv4(address);
    }
    if (isIP(address) === 6) {
        return isPublicIpv6(address);
    }
    return false;
}

function isPublicIpv4(address: string): boolean {
    const octets = address.split(".").map((part) => Number.parseInt(part, 10));
    if (octets.length !== 4 || octets.some((octet) => Number.isNaN(octet))) {
        return false;
    }
    const [a, b, c] = octets;
    if (a === 0 || a === 10 || a === 127) {
        return false;
    }
    if (a === 100 && b >= 64 && b <= 127) {
        return false; // CGNAT
    }
    if (a === 169 && b === 254) {
        return false; // link-local
    }
    if (a === 172 && b >= 16 && b <= 31) {
        return false; // RFC1918
    }
    if (a === 192 && b === 168) {
        return false; // RFC1918
    }
    if (a === 192 && (b === 0 || b === 2 || b === 51 || b === 168)) {
        return false; // IETF special purpose / documentation
    }
    if (a === 198 && (b === 18 || b === 19 || b === 51)) {
        return false; // benchmarking / TEST-NET-2
    }
    if (a === 203 && b === 0) {
        return false; // TEST-NET-3
    }
    if (a >= 224) {
        return false; // multicast / reserved / broadcast
    }
    return c >= 0;
}

function isPublicIpv6(address: string): boolean {
    const words = expandIpv6(address);
    if (!words) {
        return false;
    }
    const [w0, w1] = words;
    if (words.every((word) => word === 0)) {
        return false; // ::
    }
    if (words.slice(0, 7).every((word) => word === 0) && words[7] === 1) {
        return false; // ::1
    }
    if ((w0 & 0xfe00) === 0xfc00) {
        return false; // ULA fc00::/7
    }
    if ((w0 & 0xffc0) === 0xfe80) {
        return false; // link-local
    }
    if ((w0 & 0xffc0) === 0xfec0) {
        return false; // site-local (deprecated)
    }
    if ((w0 & 0xff00) === 0xff00) {
        return false; // multicast
    }
    if (w0 === 0x2001 && w1 === 0x0db8) {
        return false; // documentation
    }
    return true;
}

function expandIpv6(address: string): number[] | null {
    let mapped4: string | null = null;
    const v4Candidate = address.includes("::ffff:")
        ? address.slice(address.indexOf("::ffff:") + 7)
        : null;
    if (v4Candidate && v4Candidate.includes(".")) {
        mapped4 = v4Candidate;
    }
    const hexPart = mapped4 ? null : address;
    if (mapped4) {
        const parts = mapped4.split(".");
        if (parts.length !== 4) {
            return null;
        }
        const octets = parts.map((part) => Number.parseInt(part, 10));
        if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
            return null;
        }
        if (!isPublicIpv4(mapped4)) {
            return null;
        }
        return [0, 0, 0, 0, 0, 0xffff, (octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
    }
    const pieces = hexPart!.split("::");
    if (pieces.length > 2) {
        return null;
    }
    const head = pieces[0] ? pieces[0].split(":") : [];
    const tail = pieces.length === 2 && pieces[1] ? pieces[1].split(":") : [];
    const headWords = head.map((part) => Number.parseInt(part, 16));
    const tailWords = tail.map((part) => Number.parseInt(part, 16));
    if (headWords.some((word) => Number.isNaN(word)) || tailWords.some((word) => Number.isNaN(word))) {
        return null;
    }
    const gap = pieces.length === 2 ? 8 - headWords.length - tailWords.length : 0;
    if (gap < 0 || (pieces.length === 1 && headWords.length !== 8)) {
        return null;
    }
    return [...headWords, ...Array.from({ length: gap }, () => 0), ...tailWords];
}
