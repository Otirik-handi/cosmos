import { AsyncLocalStorage } from "node:async_hooks";

import { describe, expect, it } from "vitest";

import type {
    RunSnapshot,
    SourceConfigProbeCommand,
    SourceSnapshot,
    SourceProbeResult,
} from "@cosmos/contracts";

import {
    ConnectorRegistry,
    ConnectorProbeService,
    createBuiltinManifestCatalog,
    IngestionService,
    IngestionWorker,
    SourceConfigProbeService,
    type CosmosRepository,
    type IngestConnector,
    type LoggerContext,
    type LoggerPort,
} from "./index.js";

import { captureLogger, source } from "./test-support.js";

describe("ConnectorRegistry", () => {
    it("resolves by the manifest-projected connector id", () => {
        const connector: IngestConnector = {
            id: "bilibili",
            description: "Bilibili",
            configVersion: "v1",
            capabilities: ["opencli"],
            validate: () => undefined,
            async fetchItems() {
                return { items: [], nextCursor: null };
            },
        };
        const registry = new ConnectorRegistry([connector]);

        expect(registry.resolve(source({ kind: "legacy-bilibili" }))).toBe(connector);
        expect(registry.descriptors()).toEqual([{
            id: "bilibili",
            description: "Bilibili",
            capabilities: ["opencli"],
            configVersion: "v1",
        }]);
    });
});
