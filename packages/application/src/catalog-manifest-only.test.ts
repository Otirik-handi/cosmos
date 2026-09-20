import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createBuiltinManifestCatalog } from "./catalog.js";
import { ConnectorRegistry } from "./connector-registry.js";
import type { IngestConnector } from "./connector-ports.js";

/**
 * EXT-008 的 API 半边：API 只加载 manifest、schema 和 capability，Worker 独占 executable。
 *
 * 本文件守住「API 进程拿不到 Connector executable」这条边界：catalog 只提供数据
 * （manifest / schema / capability），执行入口在 Worker 组合根构造的 ConnectorRegistry 里。
 * 边界被破坏（例如把 executable 塞进 catalog，或让 API 依赖 plugin-collectors）时这里先红。
 */
describe("EXT-008 manifest-only catalog", () => {
    it("serves every built-in source definition without a connector executable", () => {
        const catalog = createBuiltinManifestCatalog();
        const definitions = catalog.listSourceDefinitions();

        // 四个内置来源全部以 manifest 形式可得，且不需要任何 executable 参与。
        expect(definitions.map((item) => item.id).sort()).toEqual([
            "aihot",
            "bilibili",
            "fixture-rss",
            "rss",
        ]);
        for (const definition of definitions) {
            expect(definition.ref).toBe(`source.${definition.id}@${definition.version}`);
            expect(definition.operationIds.length).toBeGreaterThan(0);
            expect(definition.capabilities.length).toBeGreaterThan(0);
            // schema 与 hash 是 manifest 自带的投影，不是运行时从 executable 推导出来的。
            expect(definition.configurationSchema.id).toBe(
                `source.${definition.id}.config@${definition.version}`,
            );
            expect(definition.manifestHash.value).toBe(`builtin:source.${definition.id}@1`);
        }
    });

    it("projects connector descriptors from the same manifests", () => {
        const catalog = createBuiltinManifestCatalog();
        const definitions = catalog.listSourceDefinitions();

        // /connectors 的目录来自 manifest 的 connectorId，与 executable registry 是两份数据。
        expect(catalog.listConnectors().map((item) => item.id).sort()).toEqual(
            definitions.map((item) => item.connectorId).sort(),
        );
    });

    it("exposes catalog data as copies, not as live references", () => {
        const catalog = createBuiltinManifestCatalog();
        const [first] = catalog.listSourceDefinitions();
        const capabilities = first?.capabilities ?? [];

        // 调用方改不动 catalog 里的数据：返回的是逐层复制的投影。
        (capabilities as string[]).push("tampered");
        expect(catalog.listSourceDefinitions()[0]?.capabilities).not.toContain("tampered");
    });

    it("keeps the executable registry out of the API process", () => {
        // 执行入口只存在于 Worker 组合根构造的 ConnectorRegistry；catalog 没有执行面。
        const catalog = createBuiltinManifestCatalog();
        for (const key of ["fetch", "fetchItems", "execute", "resolve"]) {
            expect(key in catalog).toBe(false);
        }

        // 结构性保证：API 构建里没有 executable 的来源。
        const apiPackage = JSON.parse(
            readFileSync(join(process.cwd(), "apps/api/package.json"), "utf8"),
        ) as { dependencies?: Record<string, string> };
        expect(apiPackage.dependencies).not.toHaveProperty("@cosmos/plugin-collectors");
    });

    it("requires an explicit executable to execute anything", async () => {
        // catalog 只有数据；真正执行需要单独注册的 executable（Worker 侧）。
        const calls: string[] = [];
        const connector: IngestConnector = {
            id: "rss",
            description: "RSS",
            configVersion: "source.rss@1",
            capabilities: ["source:read"],
            validate: () => undefined,
            async fetchItems() {
                calls.push("fetch");
                return { items: [], nextCursor: null };
            },
        };
        const registry = new ConnectorRegistry([connector]);

        expect(registry.descriptors().map((item) => item.id)).toEqual(["rss"]);
        expect(calls).toEqual([]);
    });
});
