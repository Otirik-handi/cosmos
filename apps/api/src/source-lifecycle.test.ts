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

    it("rejects a Bilibili feed config without a profile before creating", async () => {
        const repository = {
            createSource: vi.fn(),
        };
        const controller = new AppController(
            repository as never,
            new SourceProbeService(createBuiltinManifestCatalog()) as never,
        );

        const error = await controller.createSource({
            name: "Bilibili feed",
            sourceDefinitionRef: "source.bilibili@1",
            operationId: "fetch",
            config: { mode: "feed" },
        }).catch((value) => value);

        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.getResponse()).toMatchObject({ code: "validation_failed" });
        expect(repository.createSource).not.toHaveBeenCalled();
    });

    it("validates saved config before forwarding an activation command", async () => {
        const activated = {
            ...source,
            enabled: true,
            revisionId: "source-1:2",
        };
        const repository = {
            getSource: vi.fn().mockResolvedValue(source),
            activateSource: vi.fn().mockResolvedValue(activated),
        };
        const sourceProbe = {
            validate: vi.fn(),
        };
        const controller = new AppController(repository as never, sourceProbe as never);

        await expect(controller.activateSource("source-1", {
            enabled: true,
            baseRevisionId: "source-1:1",
        }, "activation-1")).resolves.toMatchObject({
            enabled: true,
            revisionId: "source-1:2",
        });

        expect(sourceProbe.validate).toHaveBeenCalledWith({
            sourceDefinitionRef: "source.rss@1",
            operationId: "fetch",
            config: source.config,
        });
        expect(repository.activateSource).toHaveBeenCalledWith({
            sourceId: "source-1",
            idempotencyKey: "activation-1",
            enabled: true,
            baseRevisionId: "source-1:1",
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