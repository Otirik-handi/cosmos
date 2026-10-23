import { describe, expect, it, vi } from "vitest";

import {
    createHttpsProviderModelDirectory,
    createPinnedLookup,
    type ProviderModelDirectoryEgress,
    type ProviderModelDirectoryEgressRequest,
} from "./provider-model-directory-https.js";
import { ProviderModelDirectoryError } from "./provider-model-directory.js";

const publicAnswer = "93.184.216.34";

function jsonBody(value: unknown): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(value));
}

/** 记录每次外呼的入参，避免测试触达真实网络。 */
function recordingEgress(
    respond: (request: ProviderModelDirectoryEgressRequest) => Promise<{ status: number; body: Uint8Array }>,
) {
    const calls: ProviderModelDirectoryEgressRequest[] = [];
    const egress: ProviderModelDirectoryEgress = {
        request: vi.fn(async (request) => {
            calls.push(request);
            return respond(request);
        }),
    };
    return { egress, calls };
}

describe("createHttpsProviderModelDirectory", () => {
    it("binds the audited address while keeping the saved hostname for TLS and Host", async () => {
        const { egress, calls } = recordingEgress(async () => ({
            status: 200,
            body: jsonBody({ data: [{ id: "gpt-x" }] }),
        }));
        const directory = createHttpsProviderModelDirectory({
            resolveHost: async () => [publicAnswer],
            egress,
        });

        const response = await directory.requestModels({
            url: "https://provider.example/v1/models",
            bearerToken: "synthetic-key",
        });

        expect(response).toEqual({ status: 200, body: { data: [{ id: "gpt-x" }] } });
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
            address: publicAnswer,
            family: 4,
            hostname: "provider.example",
            bearerToken: "synthetic-key",
            timeoutMs: 10_000,
            maxBytes: 1024 * 1024,
        });
        expect(calls[0]!.url.href).toBe("https://provider.example/v1/models");
    });

    it("refuses a host when any resolved answer is not public", async () => {
        const { egress, calls } = recordingEgress(async () => ({ status: 200, body: jsonBody({}) }));
        const directory = createHttpsProviderModelDirectory({
            resolveHost: async () => [publicAnswer, "10.0.0.7"],
            egress,
        });

        await expect(directory.requestModels({
            url: "https://provider.example/v1/models",
            bearerToken: "synthetic-key",
        })).rejects.toMatchObject({ code: "dependency_unavailable" });
        expect(calls).toHaveLength(0);
    });

    it("refuses non-HTTPS URLs, embedded credentials and private literal hosts before dialing", async () => {
        const { egress, calls } = recordingEgress(async () => ({ status: 200, body: jsonBody({}) }));
        const directory = createHttpsProviderModelDirectory({
            resolveHost: async () => ["10.0.0.7"],
            egress,
        });

        for (const url of [
            "http://provider.example/v1/models",
            "https://user:pass@provider.example/v1/models",
            "https://127.0.0.1/v1/models",
            "https://[::1]/v1/models",
        ]) {
            await expect(directory.requestModels({ url, bearerToken: "synthetic-key" }))
                .rejects.toBeInstanceOf(ProviderModelDirectoryError);
        }
        expect(calls).toHaveLength(0);
    });

    it("returns the upstream status without following redirects", async () => {
        const { egress, calls } = recordingEgress(async () => ({ status: 302, body: new Uint8Array() }));
        const directory = createHttpsProviderModelDirectory({
            resolveHost: async () => [publicAnswer],
            egress,
        });

        const response = await directory.requestModels({
            url: "https://provider.example/v1/models",
            bearerToken: "synthetic-key",
        });

        expect(response.status).toBe(302);
        // 失败响应不解析正文：错误页通常是 HTML，解析失败会掩盖真实状态码。
        expect(response.body).toBeNull();
        expect(calls).toHaveLength(1);
    });

    it("aborts one in-flight request when the total budget expires", async () => {
        const { egress } = recordingEgress((request) => new Promise((_, reject) => {
            request.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }));
        const directory = createHttpsProviderModelDirectory({
            resolveHost: async () => [publicAnswer],
            egress,
            timeoutMs: 20,
        });

        await expect(directory.requestModels({
            url: "https://provider.example/v1/models",
            bearerToken: "synthetic-key",
        })).rejects.toMatchObject({ code: "timeout" });
    });

    it("rejects a response that exceeds the byte budget and one that is not JSON", async () => {
        const large = recordingEgress(async () => ({
            status: 200,
            body: new Uint8Array(64),
        }));
        const limited = createHttpsProviderModelDirectory({
            resolveHost: async () => [publicAnswer],
            egress: large.egress,
            maxBytes: 16,
        });
        await expect(limited.requestModels({
            url: "https://provider.example/v1/models",
            bearerToken: "synthetic-key",
        })).rejects.toMatchObject({ code: "response_too_large" });

        const broken = recordingEgress(async () => ({
            status: 200,
            body: new TextEncoder().encode("<html>not json</html>"),
        }));
        const decoding = createHttpsProviderModelDirectory({
            resolveHost: async () => [publicAnswer],
            egress: broken.egress,
        });
        await expect(decoding.requestModels({
            url: "https://provider.example/v1/models",
            bearerToken: "synthetic-key",
        })).rejects.toMatchObject({ code: "malformed_response" });
    });

    it("surfaces a resolver outage as a dependency failure without dialing", async () => {
        const { egress, calls } = recordingEgress(async () => ({ status: 200, body: jsonBody({}) }));
        const directory = createHttpsProviderModelDirectory({
            resolveHost: async () => {
                throw new Error("dns said no");
            },
            egress,
        });

        await expect(directory.requestModels({
            url: "https://provider.example/v1/models",
            bearerToken: "synthetic-key",
        })).rejects.toMatchObject({ code: "dependency_unavailable" });
        expect(calls).toHaveLength(0);
    });
});

describe("createPinnedLookup", () => {
    type LookupCallback = (...args: unknown[]) => void;

    function resolveWith(options: unknown): unknown[] {
        const received: unknown[] = [];
        const lookup = createPinnedLookup("93.184.216.34", 4);
        (lookup as unknown as (host: string, options: unknown, callback: LookupCallback) => void)(
            "provider.example",
            options,
            (...args: unknown[]) => { received.push(...args); },
        );
        return received;
    }

    // autoSelectFamily 默认开启，net 会以 { all: true } 调 lookup，只回单个地址会让
    // 回调被当成 node 的 addresses 数组，net 从中取 address 得到 undefined。
    it("returns an address array when the caller asks for all addresses", () => {
        const received = resolveWith({ all: true, hints: 0 });

        expect(received[0]).toBeNull();
        expect(received[1]).toEqual([{ address: "93.184.216.34", family: 4 }]);
    });

    it("returns a single address when the caller does not ask for all", () => {
        const received = resolveWith({ hints: 0 });

        expect(received[0]).toBeNull();
        expect(received[1]).toBe("93.184.216.34");
        expect(received[2]).toBe(4);
    });
});
