import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { createBuiltinManifestCatalog } from "@cosmos/application";
import { AppController } from "./app.controller.js";
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
});