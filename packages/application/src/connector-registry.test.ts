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
} from "./connector-registry.js";
import {
    ConnectorProbeService,
    SourceConfigProbeService,
} from "./connector-probe.js";
import {
    createBuiltinManifestCatalog,
} from "./catalog.js";
import {
    IngestionService,
} from "./ingestion-service.js";
import {
    IngestionWorker,
} from "./ingestion-worker.js";
import type {
    CosmosRepository,
} from "./repository-port.js";
import type {
    IngestConnector,
} from "./connector-ports.js";
import type {
    LoggerContext,
    LoggerPort,
} from "./logger.js";

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
