import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { isIP } from "node:net";

import { isPublicAddress } from "./public-address.js";
import {
    ProviderModelDirectoryError,
    type ProviderModelDirectoryPort,
    type ProviderModelDirectoryRequest,
    type ProviderModelDirectoryResponse,
} from "./provider-model-directory.js";

/** 受控外呼只允许打到已审核的地址；TLS 与 Host 仍然用 Provider 保存的主机名。 */
export interface ProviderModelDirectoryEgressRequest {
    url: URL;
    /** 本次已审核的目的地址（IP 字面量）。 */
    address: string;
    family: 4 | 6;
    hostname: string;
    bearerToken: string;
    timeoutMs: number;
    maxBytes: number;
    signal: AbortSignal;
}

export interface ProviderModelDirectoryEgressResponse {
    status: number;
    body: Uint8Array;
}

export interface ProviderModelDirectoryEgress {
    request(input: ProviderModelDirectoryEgressRequest): Promise<ProviderModelDirectoryEgressResponse>;
}

export type ProviderModelDirectoryHostResolver = (host: string) => Promise<readonly string[]>;

export interface HttpsProviderModelDirectoryOptions {
    /** 测试接缝：默认走 node:dns。 */
    resolveHost?: ProviderModelDirectoryHostResolver;
    /** 测试接缝：默认走 node:https，并以 lookup 绑定已审核地址。 */
    egress?: ProviderModelDirectoryEgress;
    timeoutMs?: number;
    maxBytes?: number;
}

export const PROVIDER_DIRECTORY_TIMEOUT_MS = 10_000;
export const PROVIDER_DIRECTORY_MAX_BYTES = 1024 * 1024;

function directoryFailure(
    code: "timeout" | "response_too_large" | "dependency_unavailable" | "malformed_response",
): ProviderModelDirectoryError {
    return new ProviderModelDirectoryError(code as "timeout" | "response_too_large" | "dependency_unavailable");
}

async function defaultResolveHost(host: string): Promise<readonly string[]> {
    const { lookup } = await import("node:dns/promises");
    const answers = await lookup(host, { all: true, verbatim: true });
    return answers.map((answer) => answer.address);
}

/**
 * 解析一次、审核全部答案、再只拨已审核地址。
 *
 * 所有答案都必须是公网地址：轮换/多答案 DNS 里出现一个私网地址就整体拒绝，
 * 否则同一主机名可以把连接引到内网。
 */
function auditedAddress(answers: readonly string[]): { address: string; family: 4 | 6 } {
    if (answers.length === 0) {
        throw directoryFailure("dependency_unavailable");
    }
    for (const answer of answers) {
        if (!isPublicAddress(answer)) {
            throw directoryFailure("dependency_unavailable");
        }
    }
    const address = answers[0]!;
    return { address, family: isIP(address) === 6 ? 6 : 4 };
}

function assertAllowedUrl(rawUrl: string): URL {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        throw directoryFailure("dependency_unavailable");
    }
    if (url.protocol !== "https:") {
        throw directoryFailure("dependency_unavailable");
    }
    if (url.username !== "" || url.password !== "") {
        throw directoryFailure("dependency_unavailable");
    }
    if (url.search !== "" || url.hash !== "") {
        throw directoryFailure("dependency_unavailable");
    }
    // 字面量地址不走 DNS 审核，因此这里必须直接拒绝非公网地址。
    const literal = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(literal) !== 0 && !isPublicAddress(literal)) {
        throw directoryFailure("dependency_unavailable");
    }
    return url;
}

function decodeJson(body: Uint8Array, maxBytes: number): unknown {
    if (body.byteLength > maxBytes) {
        throw directoryFailure("response_too_large");
    }
    try {
        return JSON.parse(new TextDecoder().decode(body)) as unknown;
    } catch {
        throw directoryFailure("malformed_response");
    }
}

/**
 * 只有 2xx 才解析 JSON。失败响应只需要状态码，调用方按码映射固定错误；
 * 强制解析错误页 HTML 会把“上游拒绝”误报成“响应格式错误”。
 */
function bodyForStatus(status: number, body: Uint8Array, maxBytes: number): unknown {
    if (status < 200 || status >= 300) {
        if (body.byteLength > maxBytes) throw directoryFailure("response_too_large");
        return null;
    }
    return decodeJson(body, maxBytes);
}

/**
 * `ProviderModelDirectoryPort` 的唯一生产实现。
 *
 * 超时是整次请求（解析 + 连接 + TLS + 读取）的总预算，不是每阶段各 10 秒：
 * 发现由用户点击同步触发，必须有一个可预测的上界。
 */
export function createHttpsProviderModelDirectory(
    options: HttpsProviderModelDirectoryOptions = {},
): ProviderModelDirectoryPort {
    const resolveHost = options.resolveHost ?? defaultResolveHost;
    const egress = options.egress ?? createNodeHttpsEgress();
    const timeoutMs = options.timeoutMs ?? PROVIDER_DIRECTORY_TIMEOUT_MS;
    const maxBytes = options.maxBytes ?? PROVIDER_DIRECTORY_MAX_BYTES;

    return {
        async requestModels(input: ProviderModelDirectoryRequest): Promise<ProviderModelDirectoryResponse> {
            const url = assertAllowedUrl(input.url);
            const controller = new AbortController();
            let timedOut = false;
            const timer = setTimeout(() => {
                timedOut = true;
                controller.abort();
            }, timeoutMs);
            if (typeof timer.unref === "function") timer.unref();

            try {
                const answers = await resolveHost(url.hostname);
                const audited = auditedAddress(answers);
                const response = await egress.request({
                    url,
                    address: audited.address,
                    family: audited.family,
                    hostname: url.hostname,
                    bearerToken: input.bearerToken,
                    timeoutMs,
                    maxBytes,
                    signal: controller.signal,
                });
                return { status: response.status, body: bodyForStatus(response.status, response.body, maxBytes) };
            } catch (error) {
                if (timedOut) throw directoryFailure("timeout");
                if (error instanceof ProviderModelDirectoryError) throw error;
                throw directoryFailure("dependency_unavailable");
            } finally {
                clearTimeout(timer);
            }
        },
    };
}

/**
 * 把已经审核过的地址固定给底层 socket，同时让 TLS 继续按主机名校验。
 *
 * Node 20+ 的 `autoSelectFamily` 会以 `{ all: true }` 调 lookup，此时回调必须给数组；
 * 只回单个字符串时 net 取 `address.address` 得到 undefined，抛 `ERR_INVALID_IP_ADDRESS`。
 * 两种形状都只能出现这一个已审核地址，不要把解析结果原样透传。
 */
export function createPinnedLookup(address: string, family: 4 | 6): LookupFunction {
    return (_hostname, options, callback) => {
        if (options.all === true) {
            callback(null, [{ address, family }]);
            return;
        }
        callback(null, address, family);
    };
}

/** Node 侧的默认外呼：lookup 固定返回已审核地址，TLS 仍校验原始主机名。 */
export function createNodeHttpsEgress(): ProviderModelDirectoryEgress {
    return {
        request(input) {
            return new Promise((resolve, reject) => {
                const lookup = createPinnedLookup(input.address, input.family);
                const outgoing = httpsRequest(
                    {
                        protocol: input.url.protocol,
                        hostname: input.hostname,
                        port: input.url.port === "" ? 443 : Number(input.url.port),
                        path: `${input.url.pathname}${input.url.search}`,
                        method: "GET",
                        headers: {
                            accept: "application/json",
                            authorization: `Bearer ${input.bearerToken}`,
                        },
                        lookup,
                        // 地址绑定后仍以保存的主机名做 SNI 与证书校验。
                        servername: input.hostname,
                        signal: input.signal,
                        timeout: input.timeoutMs,
                    },
                    (response) => {
                        const chunks: Uint8Array[] = [];
                        let size = 0;
                        let settled = false;
                        const fail = (code: "response_too_large" | "dependency_unavailable"): void => {
                            if (settled) return;
                            settled = true;
                            response.destroy();
                            reject(new ProviderModelDirectoryError(code));
                        };
                        response.on("data", (chunk: Buffer) => {
                            if (settled) return;
                            size += chunk.byteLength;
                            if (size > input.maxBytes) {
                                fail("response_too_large");
                                return;
                            }
                            chunks.push(chunk);
                        });
                        response.on("error", () => fail("dependency_unavailable"));
                        response.on("end", () => {
                            if (settled) return;
                            settled = true;
                            resolve({
                                status: response.statusCode ?? 0,
                                body: Buffer.concat(chunks),
                            });
                        });
                    },
                );
                outgoing.on("timeout", () => outgoing.destroy(new Error("directory request timed out")));
                outgoing.on("error", (error) => reject(error));
                outgoing.end();
            });
        },
    };
}
