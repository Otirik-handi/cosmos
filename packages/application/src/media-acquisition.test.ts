import { describe, expect, it } from "vitest";

import type { NormalizedAssetInput, NormalizedIngestItem } from "@cosmos/domain";
import {
    createMediaAcquirer,
    isPublicAddress,
    parseAllowedHosts,
    type HostResolver,
} from "./media-acquisition.js";

const pngSignature = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);
const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);

function asset(overrides: Partial<NormalizedAssetInput>): NormalizedAssetInput {
    return {
        kind: "image",
        sourceUrl: "https://media.example.test/a.png",
        status: "metadata_only",
        mimeType: null,
        byteSize: null,
        content: null,
        ...overrides,
    };
}

function item(assets: readonly NormalizedAssetInput[]): NormalizedIngestItem {
    return {
        externalId: "x-1",
        title: "T",
        summary: null,
        contentText: "C",
        webUrl: "https://media.example.test/post/1",
        kind: "article",
        publisher: null,
        metrics: null,
        publishedAt: null,
        sourceLocator: { provider: "rss", feedUrl: "https://media.example.test/feed.xml" },
        rawPayload: "",
        assets,
    };
}

function okImage(bytes: Uint8Array, contentType?: string): Response {
    const headers: Record<string, string> = {};
    if (contentType) {
        headers["content-type"] = contentType;
    }
    return new Response(bytes as unknown as BodyInit, { status: 200, headers });
}

type FakeHandler = (url: string) => Response | Promise<Response>;

function fakeFetch(routes: Record<string, FakeHandler>) {
    const calls: string[] = [];
    const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
        const url = typeof input === "string"
            ? input
            : (input instanceof URL ? input.href : input.url);
        calls.push(url);
        const handler = routes[url];
        if (!handler) {
            throw new Error(`Unexpected request: ${url}`);
        }
        return handler(url);
    };
    return { fetchImpl, calls };
}

function publicResolver(host: string): Promise<string[]> {
    return Promise.resolve(["93.184.216.34"]);
}

describe("media acquisition (ADR-0005)", () => {
    it("saves a downloaded image candidate and clears errorMessage", async () => {
        const { fetchImpl, calls } = fakeFetch({
            "https://media.example.test/a.png": () => okImage(pngSignature, "image/png"),
        });
        const acquirer = createMediaAcquirer({
            fetch: fetchImpl,
            resolveHost: publicResolver,
        });
        const [out] = await acquirer.acquireItems([item([asset({})])]);
        expect(calls).toHaveLength(1);
        const saved = out.assets[0];
        expect(saved.status).toBe("saved");
        expect(saved.content).toEqual(pngSignature);
        expect(saved.mimeType).toBe("image/png");
        expect(saved.byteSize).toBe(pngSignature.byteLength);
        expect(saved.errorMessage).toBeNull();
    });

    it("sniffs image magic when content-type is octet-stream", async () => {
        const { fetchImpl } = fakeFetch({
            "https://media.example.test/a.png": () => okImage(pngSignature, "application/octet-stream"),
        });
        const acquirer = createMediaAcquirer({
            fetch: fetchImpl,
            resolveHost: publicResolver,
        });
        const [out] = await acquirer.acquireItems([item([asset({})])]);
        expect(out.assets[0].status).toBe("saved");
        expect(out.assets[0].mimeType).toBe("image/png");
    });

    it("fails when the body is not an image", async () => {
        const html = new TextEncoder().encode("<html>error page</html>");
        const { fetchImpl } = fakeFetch({
            "https://media.example.test/a.png": () => okImage(html, "text/html"),
        });
        const acquirer = createMediaAcquirer({ fetch: fetchImpl, resolveHost: publicResolver });
        const [out] = await acquirer.acquireItems([item([asset({})])]);
        expect(out.assets[0].status).toBe("failed");
        expect(out.assets[0].content).toBeNull();
        expect(out.assets[0].errorMessage).toMatch(/不是图片/);
    });

    it("fails when octet-stream body has no image magic", async () => {
        const random = new Uint8Array([9, 9, 9, 9]);
        const { fetchImpl } = fakeFetch({
            "https://media.example.test/a.png": () => okImage(random, "application/octet-stream"),
        });
        const acquirer = createMediaAcquirer({ fetch: fetchImpl, resolveHost: publicResolver });
        const [out] = await acquirer.acquireItems([item([asset({})])]);
        expect(out.assets[0].status).toBe("failed");
        expect(out.assets[0].errorMessage).toMatch(/不是图片/);
    });

    it("skips a file whose declared length exceeds the file cap", async () => {
        const { fetchImpl } = fakeFetch({
            "https://media.example.test/a.png": () => new Response("", {
                status: 200,
                headers: { "content-length": String(11 * 1024 * 1024) },
            }),
        });
        const acquirer = createMediaAcquirer({
            fetch: fetchImpl,
            resolveHost: publicResolver,
            limits: { maxFileBytes: 10 * 1024 * 1024 },
        });
        const [out] = await acquirer.acquireItems([item([asset({})])]);
        expect(out.assets[0].status).toBe("skipped");
        expect(out.assets[0].errorMessage).toMatch(/大小上限/);
        expect(fetchImpl).toBeDefined();
    });

    it("skips remaining candidates once the per-run budget is exhausted", async () => {
        const { fetchImpl } = fakeFetch({
            "https://media.example.test/a.png": () => okImage(new Uint8Array([1, 2, 3]), "image/png"),
            "https://media.example.test/b.png": () => okImage(new Uint8Array([4, 5, 6]), "image/png"),
        });
        const acquirer = createMediaAcquirer({
            fetch: fetchImpl,
            resolveHost: publicResolver,
            limits: { maxRunBytes: 3 },
        });
        const [out] = await acquirer.acquireItems([
                item([
                asset({ sourceUrl: "https://media.example.test/a.png" }),
                asset({ sourceUrl: "https://media.example.test/b.png" }),
            ]),
            ]);
        expect(out.assets[0].status).toBe("saved");
        expect(out.assets[1].status).toBe("skipped");
        expect(out.assets[1].errorMessage).toMatch(/预算/);
    });

    it("blocks non-http schemes and URLs with credentials", async () => {
        const acquirer = createMediaAcquirer({ resolveHost: publicResolver });
        const [out] = await acquirer.acquireItems([
                item([
                asset({ sourceUrl: "ftp://media.example.test/a.png" }),
                asset({ sourceUrl: "https://user:pass@media.example.test/a.png" }),
            ]),
            ]);
        expect(out.assets[0].status).toBe("skipped");
        expect(out.assets[0].errorMessage).toMatch(/协议不允许/);
        expect(out.assets[1].status).toBe("skipped");
        expect(out.assets[1].errorMessage).toMatch(/账号信息/);
    });

    it("skips hosts resolving to private addresses unless allowlisted", async () => {
        const internal: HostResolver = (host) => {
            return Promise.resolve(host === "internal.test" ? ["10.1.2.3"] : ["93.184.216.34"]);
        };
        const { fetchImpl } = fakeFetch({
            "http://internal.test/a.png": () => okImage(pngSignature, "image/png"),
        });
        const blocked = createMediaAcquirer({
            fetch: fetchImpl,
            resolveHost: internal,
        });
        const [blockedOut] = await blocked.acquireItems([
                item([asset({ sourceUrl: "http://internal.test/a.png" })]),
            ]);
        expect(blockedOut.assets[0].status).toBe("skipped");
        expect(blockedOut.assets[0].errorMessage).toMatch(/内网|本机/);

        const allowed = createMediaAcquirer({
            fetch: fetchImpl,
            resolveHost: internal,
            allowedHosts: ["internal.test"],
        });
        const [allowedOut] = await allowed.acquireItems([
                item([asset({ sourceUrl: "http://internal.test/a.png" })]),
            ]);
        expect(allowedOut.assets[0].status).toBe("saved");
    });

    it("follows a bounded manual redirect chain and re-validates each hop", async () => {
        const { fetchImpl, calls } = fakeFetch({
            "https://a.example.test/x.png": () => new Response("", {
                status: 302,
                headers: { location: "https://b.example.test/y.png" },
            }),
            "https://b.example.test/y.png": () => okImage(pngSignature, "image/png"),
        });
        const acquirer = createMediaAcquirer({ fetch: fetchImpl, resolveHost: publicResolver });
        const [out] = await acquirer.acquireItems([
                item([asset({ sourceUrl: "https://a.example.test/x.png" })]),
            ]);
        expect(calls).toHaveLength(2);
        expect(out.assets[0].status).toBe("saved");
    });

    it("fails a media acquisition that exceeds its timeout", async () => {
        const never = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            return new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () => {
                    reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
                });
            });
        };
        const acquirer = createMediaAcquirer({
            fetch: never,
            resolveHost: publicResolver,
            limits: { perMediaTimeoutMs: 5 },
        });
        const [out] = await acquirer.acquireItems([
                item([asset({ sourceUrl: "https://media.example.test/a.png" })]),
            ]);
        expect(out.assets[0].status).toBe("failed");
        expect(out.assets[0].errorMessage).toMatch(/超时/);
    });

    it("propagates an outer abort instead of degrading assets", async () => {
        const controller = new AbortController();
        const hang = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            return new Promise<Response>((_resolve, reject) => {
                if (init?.signal?.aborted) {
                    reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
                    return;
                }
                init?.signal?.addEventListener("abort", () => {
                    reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
                });
            });
        };
        const acquirer = createMediaAcquirer({
            fetch: hang,
            resolveHost: publicResolver,
        });
        const promise = acquirer.acquireItems([
                item([asset({ sourceUrl: "https://media.example.test/a.png" })]),
                ],
            { signal: controller.signal },
        );
        controller.abort();
        await expect(promise).rejects.toThrow();
    });

    it("downloads a repeated URL only once per run", async () => {
        let served = 0;
        const { fetchImpl } = fakeFetch({
            "https://media.example.test/a.png": () => {
                served += 1;
                return okImage(pngSignature, "image/png");
            },
        });
        const acquirer = createMediaAcquirer({ fetch: fetchImpl, resolveHost: publicResolver });
        const [out] = await acquirer.acquireItems([
                item([
                asset({ sourceUrl: "https://media.example.test/a.png" }),
                asset({ sourceUrl: "https://media.example.test/a.png" }),
            ]),
            ]);
        expect(served).toBe(1);
        expect(out.assets.every((entry) => entry.status === "saved")).toBe(true);
    });

    it("leaves non-download policy assets untouched", async () => {
        const audio = asset({ kind: "audio", sourceUrl: "https://media.example.test/a.mp3", mimeType: "audio/mpeg" });
        const enclosureVideo = asset({ kind: "enclosure", sourceUrl: "https://media.example.test/v.mp4", mimeType: "video/mp4" });
        const { fetchImpl } = fakeFetch({});
        const acquirer = createMediaAcquirer({ fetch: fetchImpl, resolveHost: publicResolver });
        const [out] = await acquirer.acquireItems([item([audio, enclosureVideo])]);
        expect(out.assets[0].status).toBe("metadata_only");
        expect(out.assets[1].status).toBe("metadata_only");
        expect(out.assets[0].content).toBeNull();
    });

    it("reports failed DNS resolution without downloading", async () => {
        const { fetchImpl } = fakeFetch({});
        const resolving: HostResolver = () => Promise.reject(new Error("ENOTFOUND"));
        const acquirer = createMediaAcquirer({ fetch: fetchImpl, resolveHost: resolving });
        const [out] = await acquirer.acquireItems([
                item([asset({ sourceUrl: "https://nowhere.example.test/a.png" })]),
            ]);
        expect(out.assets[0].status).toBe("failed");
        expect(out.assets[0].errorMessage).toMatch(/解析/);
    });
});

describe("media security helpers", () => {
    it("classifies private and public IPv4", () => {
        expect(isPublicAddress("127.0.0.1")).toBe(false);
        expect(isPublicAddress("10.0.0.1")).toBe(false);
        expect(isPublicAddress("192.168.1.1")).toBe(false);
        expect(isPublicAddress("169.254.169.254")).toBe(false);
        expect(isPublicAddress("172.16.0.1")).toBe(false);
        expect(isPublicAddress("8.8.8.8")).toBe(true);
        expect(isPublicAddress("93.184.216.34")).toBe(true);
    });

    it("classifies private and public IPv6", () => {
        expect(isPublicAddress("::1")).toBe(false);
        expect(isPublicAddress("::")).toBe(false);
        expect(isPublicAddress("fe80::1")).toBe(false);
        expect(isPublicAddress("fc00::1")).toBe(false);
        expect(isPublicAddress("fd12:3456::1")).toBe(false);
        expect(isPublicAddress("ff02::1")).toBe(false);
        expect(isPublicAddress("2001:db8::1")).toBe(false);
        expect(isPublicAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(true);
        expect(isPublicAddress("::ffff:192.168.1.1")).toBe(false);
        expect(isPublicAddress("::ffff:8.8.8.8")).toBe(true);
    });

    it("parses COSMOS_MEDIA_ALLOWED_HOSTS into a lowercased list", () => {
        expect(parseAllowedHosts(undefined)).toEqual([]);
        expect(parseAllowedHosts("  localhost, 127.0.0.1\t;other.test ")).toEqual(
            ["localhost", "127.0.0.1", ";other.test"],
        );
        expect(parseAllowedHosts("LOCALHOST, localhost")).toEqual(["localhost"]);
    });
});

describe("media magic sniffing", () => {
    it("recognizes png, jpeg and webp signatures through acquisition", async () => {
        const webp = new Uint8Array([
            ...new TextEncoder().encode("RIFF"),
            0, 0, 0, 0,
            ...new TextEncoder().encode("WEBP"),
        ]);
        const cases: Array<{ bytes: Uint8Array; mime: string }> = [
            { bytes: pngSignature, mime: "image/png" },
            { bytes: jpegBytes, mime: "image/jpeg" },
            { bytes: webp, mime: "image/webp" },
        ];
        for (const entry of cases) {
            const { fetchImpl } = fakeFetch({
                "https://media.example.test/f": () => okImage(entry.bytes, "application/octet-stream"),
            });
            const acquirer = createMediaAcquirer({ fetch: fetchImpl, resolveHost: publicResolver });
            const [out] = await acquirer.acquireItems([
                item([asset({ sourceUrl: "https://media.example.test/f" })]),
            ]);
            expect(out.assets[0].status).toBe("saved");
            expect(out.assets[0].mimeType).toBe(entry.mime);
        }
    });
});
