import { describe, expect, it, vi } from "vitest";

import { createLogger } from "@cosmos/logging";
import { ConnectorExecutionError } from "@cosmos/application";
import type { SourceExecutionSnapshot } from "@cosmos/contracts";

import {
    createAiHotConnector,
    createBilibiliConnector,
    createBuiltInConnectorRegistry,
    type OpenCliRunner,
} from "./index.js";

function source(input: {
    kind: "bilibili" | "aihot";
    config: Record<string, unknown>;
    /** 连接投影（Proposal connection-login-lifecycle-v1）：profile 现在住在这里。 */
    connection?: SourceExecutionSnapshot["connection"];
}): SourceExecutionSnapshot {
    return {
        id: `source-${input.kind}`,
        name: input.kind,
        sourceDefinitionRef: input.kind === "bilibili"
            ? "source.bilibili@1"
            : "source.aihot@1",
        operationId: "fetch",
        connectorId: input.kind,
        kind: input.kind,
        config: input.config,
        ...(input.connection === undefined ? {} : { connection: input.connection }),
        enabled: true,
        mediaPolicy: null,
        planId: `plan:source-${input.kind}`,
        revisionId: `source-${input.kind}:1`,
        createdAt: "2026-08-08T00:00:00.000Z",
        updatedAt: "2026-08-08T00:00:00.000Z",
    };
}

/** Bilibili 连接投影：OpenCLI profile 走连接的 `configJson`，不再是来源配置。 */
function bilibiliConnection(profile: string): NonNullable<SourceExecutionSnapshot["connection"]> {
    return {
        id: "connection-bilibili",
        connectorId: "bilibili",
        configJson: JSON.stringify({ profile }),
    };
}

describe("built-in collectors", () => {
    it("normalizes a fixed Bilibili OpenCLI hot scenario", async () => {
        const run = vi.fn<OpenCliRunner["run"]>()
            .mockResolvedValueOnce({
                stdout: "1.8.6",
                stderr: "",
                exitCode: 0,
            })
            .mockResolvedValueOnce({
                stdout: "[OK] Extension: connected\n[OK] Connectivity: passed",
                stderr: "",
                exitCode: 0,
            })
            .mockResolvedValueOnce({
                stdout: JSON.stringify([{
                    rank: 1,
                    title: "一个 B 站视频",
                    author: "Cosmos",
                    bvid: "BV1COSMOS",
                    url: "https://www.bilibili.com/video/BV1COSMOS",
                    pubdate: 1_786_170_123,
                    cover: "https://i.example.test/cover.jpg",
                }]),
                stderr: "",
                exitCode: 0,
            });
        const connector = createBilibiliConnector({
            runner: { run },
        });

        const result = await connector.fetchItems({
            source: source({
                kind: "bilibili",
                config: {
                    mode: "hot",
                    limit: 20,
                },
            }),
            cursor: null,
        });

        expect(run).toHaveBeenNthCalledWith(1, ["--version"], {
            env: {
                OPENCLI_PROFILE: undefined,
            },
        });
        expect(run).toHaveBeenNthCalledWith(2, ["doctor"], {
            env: {
                OPENCLI_PROFILE: undefined,
            },
        });
        expect(run).toHaveBeenNthCalledWith(3, [
            "bilibili",
            "hot",
            "--limit",
            "20",
            "-f",
            "json",
        ], {
            env: {
                OPENCLI_PROFILE: undefined,
            },
        });
        expect(result.items).toMatchObject([{
            externalId: "BV1COSMOS",
            title: "一个 B 站视频",
            summary: null,
            contentText: "一个 B 站视频",
            kind: "listing",
            // hot 是平台推荐流（ING-004）。
            discoveryChannel: "recommendation",
            publisher: {
                platformId: null,
                name: "Cosmos",
                kind: "user",
            },
            metrics: null,
            webUrl: "https://www.bilibili.com/video/BV1COSMOS",
            assets: [{
                kind: "cover",
                status: "metadata_only",
            }],
        }]);
        expect(result.items[0]?.publishedAt).toMatchObject({
            exact: "2026-08-08T06:22:03.000Z",
            exactPrecision: "second",
            fallback: null,
        });
        expect(result.nextCursor).toBeNull();
    });

    it("normalizes a Bilibili feed video with publisher id and metrics", async () => {
        const profiles: unknown[] = [];
        const connector = createBilibiliConnector({
            runner: {
                run: async (args, options) => {
                    profiles.push(options?.env?.OPENCLI_PROFILE);
                    return {
                        stdout: args[0] === "--version"
                            ? "1.8.6"
                            : args[0] === "doctor"
                                ? "[OK] Extension: connected\n[OK] Connectivity: passed"
                                : JSON.stringify([{
                                    bvid: "BV1FEED",
                                    title: "Feed video",
                                    owner: {
                                        mid: 9988,
                                        name: "Feed author",
                                    },
                                    view: 100,
                                    like: 8,
                                    favorite: 3,
                                    pubdate: 1_786_170_123,
                                }]),
                        stderr: "",
                        exitCode: 0,
                    };
                },
            },
        });

        const result = await connector.fetchItems({
            source: source({
                kind: "bilibili",
                config: {
                    mode: "feed",
                    limit: 1,
                },
                connection: bilibiliConnection("chrome-main"),
            }),
            cursor: null,
        });

        // 连接上的 profile 必须到达每一条子进程调用（版本、doctor、业务命令同一份）。
        expect(profiles).toEqual(["chrome-main", "chrome-main", "chrome-main"]);

        expect(result.items[0]).toMatchObject({
            kind: "video",
            // feed 是关注账号的动态（ING-004）。
            discoveryChannel: "account",
            publisher: {
                platformId: "9988",
                name: "Feed author",
            },
            metrics: {
                values: {
                    views: 100,
                    likes: 8,
                    collects: 3,
                },
            },
        });
    });

    it("keeps the logged-in Bilibili feed bound to a named profile on the connection", () => {
        const connector = createBilibiliConnector({
            runner: {
                run: async () => ({
                    stdout: "[]",
                    stderr: "",
                    exitCode: 0,
                }),
            },
        });

        // feed 的判断现在读的是连接投影：没有连接、或连接里没有 profile，都必须拒绝。
        expect(() => connector.validate(source({
            kind: "bilibili",
            config: { mode: "feed", limit: 20 },
        }))).toThrow();
        expect(() => connector.validate(source({
            kind: "bilibili",
            config: { mode: "feed", limit: 20 },
            connection: { id: "connection-bilibili", connectorId: "bilibili", configJson: "{}" },
        }))).toThrow();
        expect(() => connector.validate(source({
            kind: "bilibili",
            config: { mode: "feed", limit: 20 },
            connection: bilibiliConnection("chrome-main"),
        }))).not.toThrow();
        // hot 匿名可用：没有连接也照常通过。
        expect(() => connector.validate(source({
            kind: "bilibili",
            config: { mode: "hot" },
        }))).not.toThrow();
        // 连接里的 profile 形状非法时按配置错误拒绝，而不是悄悄不带 profile 去抓。
        expect(() => connector.validate(source({
            kind: "bilibili",
            config: { mode: "hot" },
            connection: {
                id: "connection-bilibili",
                connectorId: "bilibili",
                configJson: '{"profile":"bad profile!"}',
            },
        }))).toThrow();
    });

    it("reports a disconnected Browser Bridge before running a source command", async () => {
        const connector = createBilibiliConnector({
            runner: {
                run: async (args) => ({
                    stdout: args[0] === "--version"
                        ? "1.8.6"
                        : args[0] === "doctor"
                            ? "[MISSING] Extension: not connected"
                            : "[]",
                    stderr: "",
                    exitCode: 0,
                }),
            },
        });

        await expect(connector.fetchItems({
            source: source({
                kind: "bilibili",
                config: { mode: "hot" },
            }),
            cursor: null,
        })).rejects.toMatchObject({
            code: "dependency_unavailable",
            retryable: true,
        });
    });

    it("collects AI HOT items with the fixed endpoint and persistent cursor", async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            schemaVersion: 1,
            items: [{
                id: "aihot-1",
                title: "AI HOT 条目",
                summary: "来自公开 API 的摘要。",
                source: { name: "示例来源" },
                links: {
                    aihot: "https://aihot.virxact.com/items/aihot-1",
                    original: "https://example.com/original",
                },
                publishedAt: "2026-08-08T02:00:00.000Z",
                category: "industry",
            }],
            page: {
                nextCursor: "cursor-2",
            },
        }), {
            status: 200,
            headers: { "content-type": "application/json" },
        }));
        const connector = createAiHotConnector({
            fetch: fetcher,
        });

        const result = await connector.fetchItems({
            source: source({
                kind: "aihot",
                config: {},
            }),
            cursor: "cursor-1",
        });

        expect(fetcher).toHaveBeenCalledOnce();
        const requestUrl = String(fetcher.mock.calls[0]?.[0]);
        expect(requestUrl).toBe(
            "https://aihot.virxact.com/api/v1/items?cursor=cursor-1",
        );
        expect(result.nextCursor).toBe("cursor-2");
        expect(result.items[0]).toMatchObject({
            externalId: "aihot-1",
            title: "AI HOT 条目",
            summary: "来自公开 API 的摘要。",
            webUrl: "https://example.com/original",
            // AI HOT 是公开聚合推荐流（ING-004）。
            discoveryChannel: "recommendation",
        });
    });

    it("logs malformed AI HOT responses at the transport boundary", async () => {
        const lines: string[] = [];
        const logger = createLogger({
            service: "collector-test",
            output: "stdout",
            stdoutWriter: (line) => lines.push(line),
        });
        const connector = createAiHotConnector({
            fetch: vi.fn().mockResolvedValue(new Response("not-json", {
                status: 200,
            })),
            logger,
        });

        await expect(connector.fetchItems({
            source: source({
                kind: "aihot",
                config: {},
            }),
            cursor: null,
        })).rejects.toMatchObject({
            code: "malformed_payload",
        });
        await logger.close();

        const failed = lines
            .map((line) => JSON.parse(line) as Record<string, unknown>)
            .find((record) => record.event === "connector.transport.failed");
        expect(failed).toMatchObject({
            connectorId: "aihot",
            errorCode: "malformed_payload",
            status: 200,
        });
    });

    it("registers business source kinds instead of the OpenCLI executor", () => {
        const registry = createBuiltInConnectorRegistry({
            fetch: vi.fn() as never,
            openCliRunner: {
                run: async () => ({
                    stdout: "[]",
                    stderr: "",
                    exitCode: 0,
                }),
            },
        });

        expect(registry.descriptors().map((item) => item.id)).toEqual([
            "rss",
            "fixture-rss",
            "bilibili",
            "aihot",
        ]);
        expect(registry.descriptors().map((item) => item.id)).not.toContain("opencli");
    });

    /**
     * 连接登录探测（Proposal connection-login-lifecycle-v1 决定 2）：跑一次登录门控命令，
     * 把退出状态翻译成宿主的三种 outcome。它按**连接**调用，不需要来源。
     */
    it("probes the connection login state through the login-gated command", async () => {
        const seenArgs: string[][] = [];
        const seenProfiles: unknown[] = [];
        const connector = createBilibiliConnector({
            runner: {
                run: async (args, options) => {
                    seenArgs.push([...args]);
                    seenProfiles.push(options?.env?.OPENCLI_PROFILE);
                    return {
                        stdout: JSON.stringify({ name: "我爱吃番茄酱", uid: 1909976659 }),
                        stderr: "",
                        exitCode: 0,
                    };
                },
            },
        });

        await expect(connector.probeAuthorization?.({
            connection: bilibiliConnection("chrome-main"),
        })).resolves.toEqual({ outcome: "active", account: "我爱吃番茄酱", reason: null });
        expect(seenArgs).toEqual([["bilibili", "me", "-f", "json"]]);
        expect(seenProfiles).toEqual(["chrome-main"]);
    });

    it("maps a not-logged-in probe to expired, a broken bridge to error, and reaches for no profile", async () => {
        const connectorThrowing = (error: ConnectorExecutionError) => createBilibiliConnector({
            runner: {
                run: async () => {
                    throw error;
                },
            },
        });

        await expect(connectorThrowing(new ConnectorExecutionError(
            "authentication_required",
            "OpenCLI requires a logged-in browser profile.",
            false,
        )).probeAuthorization?.({ connection: bilibiliConnection("chrome-main") }))
            .resolves.toMatchObject({ outcome: "expired" });

        await expect(connectorThrowing(new ConnectorExecutionError(
            "dependency_unavailable",
            "OpenCLI Browser Bridge is unavailable.",
            true,
        )).probeAuthorization?.({ connection: bilibiliConnection("chrome-main") }))
            .resolves.toMatchObject({ outcome: "error" });

        // 连接没配 profile：探测没有可用的登录态可查，直接给出结论而不是去跑命令。
        const noProfile = createBilibiliConnector({
            runner: {
                run: async () => {
                    throw new Error("runner must not be called");
                },
            },
        });
        await expect(noProfile.probeAuthorization?.({
            connection: { id: "connection-bilibili", connectorId: "bilibili", configJson: null },
        })).resolves.toMatchObject({ outcome: "error" });
    });
});
