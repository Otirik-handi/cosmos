import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { createBuiltinManifestCatalog } from "@cosmos/application";
import { AppController } from "./app.controller.js";
import { toPublicSource } from "./app.controller/internals.js";
import { SourceProbeService } from "./source-probe.service.js";

const source = {
    id: "source-1",
    name: "RSS",
    sourceDefinitionRef: "source.rss@1",
    operationId: "fetch",
    connectorId: "rss",
    kind: "rss",
    config: { feedUrl: "https://example.test/feed.xml" },
    enabled: false,
    revisionId: "source-1:1",
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
    lastRunAt: null,
    lastError: null,
};

describe("AppController Source mutations", () => {
    it("validates replacement config before updating a Source", async () => {
        const repository = {
            getSource: vi.fn().mockResolvedValue(source),
            updateSource: vi.fn(),
        };
        const sourceProbe = {
            validate: vi.fn(() => {
                throw new Error("Missing required source configuration field: feedUrl");
            }),
        };
        const controller = new AppController(repository as never, sourceProbe as never);

        const error = await controller.updateSource("source-1", {
            baseRevisionId: "source-1:1",
            config: {},
        }).catch((value) => value);

        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.getResponse()).toMatchObject({ code: "validation_failed" });
        expect(sourceProbe.validate).toHaveBeenCalledWith({
            sourceDefinitionRef: "source.rss@1",
            operationId: "fetch",
            config: {},
        });
        expect(repository.updateSource).not.toHaveBeenCalled();
    });

    /**
     * 登录态校验的归属变了（Proposal connection-login-lifecycle-v1 决定 1）：profile 从
     * 来源配置搬到连接，所以建目标时不再能判定「feed 有没有登录态」——那条判断在连接器
     * 读到连接投影时发生（见 `plugins/collectors/src/index.test.ts` 的同名场景）。
     */
    it("accepts a Bilibili feed config without a profile at create time", async () => {
        const repository = {
            createSource: vi.fn(),
        };
        const controller = new AppController(
            repository as never,
            new SourceProbeService(createBuiltinManifestCatalog()) as never,
        );

        const result = await controller.createSource({
            name: "Bilibili feed",
            sourceDefinitionRef: "source.bilibili@1",
            operationId: "fetch",
            config: { mode: "feed" },
        }).catch((value) => value);

        expect(result).not.toBeInstanceOf(BadRequestException);
        expect(repository.createSource).toHaveBeenCalled();
    });

    /**
     * 多 operation 的真实消费者（EXT-006）：同一个定义的第二个 operation 有自己的配置
     * schema，建目标时必须按 `operationId` 取它，不能一律用定义级那份。
     */
    it("validates the config of the selected operation, not the definition default", async () => {
        const repository = {
            createSource: vi.fn(),
        };
        const controller = new AppController(
            repository as never,
            new SourceProbeService(createBuiltinManifestCatalog()) as never,
        );

        const accepted = await controller.createSource({
            name: "Bilibili search",
            sourceDefinitionRef: "source.bilibili@1",
            operationId: "search",
            config: { query: "cosmos" },
        }).catch((value) => value);

        expect(accepted).not.toBeInstanceOf(BadRequestException);

        // `fetch` 的 mode/limit 不是 `search` 的字段：按定义级 schema 校验就会误放行。
        const rejected = await controller.createSource({
            name: "Bilibili search",
            sourceDefinitionRef: "source.bilibili@1",
            operationId: "search",
            config: { mode: "hot" },
        }).catch((value) => value);

        expect(rejected).toBeInstanceOf(BadRequestException);
        expect(repository.createSource).toHaveBeenCalledTimes(1);
    });

    /**
     * 拒绝非法来源配置的唯一闸门在控制器边界：`repository.createSource` 自己不校验 config
     * （`packages/storage-prisma/src/repository/sources.ts` 直接 `JSON.stringify` 写库），
     * 「非法配置不落库」靠的是控制器**先校验再调仓储**这个顺序。所以这里不只看抛错，还要
     * 回读列表确认没有新来源——否则「先写库再校验」的退化仍然全绿。
     */
    it("rejects a create command with a missing required enum and leaves no new Source behind", async () => {
        // 写入桩把「落库」变成可观察的副作用：只有控制器真的调了仓储，回读才会看到第二条。
        const stored: Record<string, unknown>[] = [{...source}];
        const repository = {
            createSource: vi.fn(async (command: Record<string, unknown>) => {
                const created = {
                    ...source,
                    id: "source-2",
                    name: command.name,
                    sourceDefinitionRef: command.sourceDefinitionRef,
                    operationId: command.operationId,
                    connectorId: "bilibili",
                    kind: "bilibili",
                    config: command.config,
                };
                stored.push(created);
                return created;
            }),
            listSources: vi.fn(async () => stored),
        };
        const controller = new AppController(
            repository as never,
            new SourceProbeService(createBuiltinManifestCatalog()) as never,
        );

        const error = await controller.createSource({
            name: "Bilibili fetch without mode",
            sourceDefinitionRef: "source.bilibili@1",
            operationId: "fetch",
            config: { limit: 5 },
        }).catch((value) => value);

        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.getResponse()).toMatchObject({ code: "validation_failed" });
        // 拒绝理由必须指向缺失的必填枚举本身，而不是「定义不可用」这类无关失败。
        expect(error.getResponse()).toMatchObject({ message: expect.stringContaining("mode") });

        // 回读证据：走真实的 `GET /sources` 路径，列表里仍然只有创建前那一条。
        const listed = await controller.sources();
        expect(listed.map((item) => item.id)).toEqual(["source-1"]);
        expect(repository.createSource).not.toHaveBeenCalled();
    });

    it("validates the saved target config before enabling the plan", async () => {
        const plan = {
            id: "plan:source-1",
            name: "RSS",
            sourceId: "source-1",
            connectionId: null,
            mediaPolicy: null,
            overlapPolicy: "forbid" as const,
            enabled: false,
            revisionId: "plan:source-1:1",
            scheduleIntervalMs: null,
            webhook: null,
            createdAt: "2026-08-24T00:00:00.000Z",
            updatedAt: "2026-08-24T00:00:00.000Z",
        };
        const repository = {
            getSource: vi.fn().mockResolvedValue(source),
            getCollectionPlan: vi.fn().mockResolvedValue(plan),
            updateCollectionPlan: vi.fn().mockResolvedValue({
                ...plan,
                enabled: true,
                revisionId: "plan:source-1:2",
            }),
        };
        const sourceProbe = {
            validate: vi.fn(),
        };
        const controller = new AppController(repository as never, sourceProbe as never);

        await expect(controller.updateCollectionPlan("plan:source-1", {
            enabled: true,
            baseRevisionId: "plan:source-1:1",
        })).resolves.toMatchObject({
            enabled: true,
            revisionId: "plan:source-1:2",
        });

        expect(sourceProbe.validate).toHaveBeenCalledWith({
            sourceDefinitionRef: "source.rss@1",
            operationId: "fetch",
            config: source.config,
        });
        expect(repository.updateCollectionPlan).toHaveBeenCalledWith("plan:source-1", {
            enabled: true,
            baseRevisionId: "plan:source-1:1",
        });
    });
    it("rejects an out-of-range schedule interval before updating", async () => {
        const repository = {
            getSource: vi.fn().mockResolvedValue(source),
            updateSource: vi.fn(),
        };
        const sourceProbe = new SourceProbeService(createBuiltinManifestCatalog());
        const controller = new AppController(repository as never, sourceProbe as never);

        const error = await controller.updateSource("source-1", {
            baseRevisionId: "source-1:1",
            config: { feedUrl: "https://example.test/feed.xml", scheduleIntervalMs: 1 },
        }).catch((value) => value);

        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.getResponse()).toMatchObject({ code: "validation_failed" });
        expect(repository.updateSource).not.toHaveBeenCalled();
    });

    /**
     * EXT-006 的「API 按声明展示配置」：公开投影的 `config` 白名单来自该 operation 的
     * canonical 配置 schema，而不是按 `connectorId` 硬编码——否则第二个 operation 的字段
     * （Bilibili `search` 的查询词）读回来就没了。
     */
    it("projects the config fields declared by the operation", () => {
        const projected = (input: Record<string, unknown>) =>
            toPublicSource({...source, ...input} as never).config;

        expect(projected({
            sourceDefinitionRef: "source.bilibili@1",
            operationId: "search",
            config: { schemaVersion: 1, query: "cosmos", limit: 20 },
        })).toEqual({ schemaVersion: 1, query: "cosmos", limit: 20 });

        // 同一个定义的 `fetch` 仍然只投影它自己声明的字段。
        expect(projected({
            sourceDefinitionRef: "source.bilibili@1",
            operationId: "fetch",
            config: { mode: "hot", limit: 20, query: "stale" },
        })).toEqual({ mode: "hot", limit: 20 });

        // RSS 与未登记 canonical schema 的来源：仍是 feedUrl，未声明的键不投影。
        expect(projected({
            config: { feedUrl: "https://example.test/feed.xml", profile: "chrome-main" },
        })).toEqual({ feedUrl: "https://example.test/feed.xml" });
        expect(projected({
            sourceDefinitionRef: "source.unknown@1",
            config: { feedUrl: "https://example.test/feed.xml", profile: "chrome-main" },
        })).toEqual({ feedUrl: "https://example.test/feed.xml" });
    });
});