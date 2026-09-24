import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { NormalizedAssetInput } from "@cosmos/domain";
import type { LoggerPort } from "./logger.js";
import { isPublicAddress } from "./public-address.js";
import type { MediaAcquisitionLimits, MediaPolicy } from "./media-policy.js";
import type { DegradedMedia, HostResolver, MediaAcquirerOptions, MediaOutcome } from "./media-ports.js";

export interface AcquisitionDeps {
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

export async function acquireImageCandidate(
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
            errorCode: timedOut ? "timeout" : "network",
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
        ...(result.status !== "saved"
            ? { errorCode: result.errorCode, errorMessage: result.errorMessage }
            : {}),
        ...(result.status === "saved" ? { byteSize: result.bytes.byteLength } : {}),
    });
    return result;
}

export function checkUrl(
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
            errorCode: "invalid_url",
        };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return {
            status: "skipped",
            errorMessage: "图片地址协议不允许",
            errorCode: "security_blocked",
        };
    }
    if (parsed.username || parsed.password) {
        return {
            status: "skipped",
            errorMessage: "图片地址不允许包含账号信息",
            errorCode: "security_blocked",
        };
    }
    return parsed;
}

export async function checkHostAllowed(
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
            errorCode: "network",
        };
    }
    if (addresses.length === 0) {
        return {
            status: "failed",
            errorMessage: "无法解析图片服务器地址",
            errorCode: "network",
        };
    }
    const blocked = addresses.find((address) => !isPublicAddress(address));
    if (blocked) {
        return {
            status: "skipped",
            errorMessage: "图片服务器位于内网或本机地址，已拦截",
            errorCode: "security_blocked",
        };
    }
    return { ok: true };
}

export async function downloadWithRedirects(
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
                    errorCode: "network",
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
                errorCode: "http_error",
            };
        }
        return consumeImageBody(response, deps, controller);
    }
    return {
        status: "failed",
        errorMessage: "图片重定向次数过多",
        errorCode: "network",
    };
}

export async function consumeImageBody(
    response: Response,
    deps: AcquisitionDeps,
    controller: AbortController,
): Promise<MediaOutcome> {
    const remaining = deps.limits.maxRunBytes - deps.state.runBytes;
    if (remaining <= 0) {
        return {
            status: "skipped",
            errorMessage: "单次运行媒体预算已用尽",
            errorCode: "budget_run",
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
            errorCode: declaredLength > deps.limits.maxFileBytes
                ? "budget_file"
                : "budget_run",
        };
    }

    const mime = parseContentType(response.headers.get("content-type"));
    const needsSniff = mime === null || mime === "application/octet-stream";
    if (!needsSniff && !mime.startsWith("image/")) {
        return {
            status: "failed",
            errorMessage: "图片下载内容不是图片类型",
            errorCode: "not_image",
        };
    }

    if (!response.body) {
        return {
            status: "failed",
            errorMessage: "图片响应没有内容",
            errorCode: "network",
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
                errorCode: fileCap === deps.limits.maxFileBytes
                    ? "budget_file"
                    : "budget_run",
            };
        }
        chunks.push(value);
    }
    const bytes = concatBytes(chunks, size);
    if (bytes.length === 0) {
        return {
            status: "failed",
            errorMessage: "图片响应没有内容",
            errorCode: "network",
        };
    }

    let storedMime = mime;
    if (needsSniff) {
        const sniffed = sniffImageMime(bytes);
        if (!sniffed) {
            return {
                status: "failed",
                errorMessage: "图片下载内容不是图片类型",
                errorCode: "not_image",
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

export function isRedirect(status: number): boolean {
    return status === 301 || status === 302 || status === 303
        || status === 307 || status === 308;
}

export function parseContentType(value: string | null): string | null {
    if (!value) {
        return null;
    }
    const raw = value.split(";", 1)[0].trim().toLowerCase();
    return raw || null;
}

export function sniffImageMime(bytes: Uint8Array): string | null {
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

export function hasPrefix(bytes: Uint8Array, prefix: number[]): boolean {
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

export function ascii(bytes: Uint8Array, offset: number, length: number): string {
    let value = "";
    for (let index = offset; index < offset + length; index += 1) {
        value += String.fromCharCode(bytes[index]);
    }
    return value;
}

export function concatBytes(chunks: Uint8Array[], size: number): Uint8Array {
    const out = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return out;
}

export function describeHost(sourceUrl: string): string | null {
    try {
        return new URL(sourceUrl).host;
    } catch {
        return null;
    }
}

export async function defaultResolveHost(host: string): Promise<readonly string[]> {
    if (isIP(host)) {
        return [host];
    }
    const result = await lookup(host, { all: true, verbatim: true });
    return result.map((entry) => entry.address);
}
