import { ConnectorRegistry } from "@cosmos/application";
import { createFixtureRssConnector, createRssConnector } from "@cosmos/plugin-rss";
import type { IngestConnector, LoggerPort } from "@cosmos/application";
import { createAiHotConnector } from "./aihot-connector.js";
import { createBilibiliConnector, createOpenCliConnector } from "./bilibili-connector.js";
import type { AiHotConnectorOptions } from "./aihot-connector.js";
import type { OpenCliConnectorOptions } from "./bilibili-connector.js";
import type { OpenCliRunner, OpenCliRunnerOptions } from "./opencli-runner.js";

export function createBuiltInConnectorRegistry(options: {
    workspaceRoot?: string;
    fetch?: typeof globalThis.fetch;
    openCliExecutable?: string;
    openCliRunner?: OpenCliRunner;
    logger?: LoggerPort;
} = {}): ConnectorRegistry {
    return new ConnectorRegistry([
        createRssConnector({
            fetch: options.fetch,
            logger: options.logger,
        }),
        createFixtureRssConnector({
            rootDirectory: options.workspaceRoot,
            logger: options.logger,
        }),
        createBilibiliConnector({
            executable: options.openCliExecutable,
            runner: options.openCliRunner,
            logger: options.logger,
        }),
        createAiHotConnector({
            fetch: options.fetch,
            logger: options.logger,
        }),
    ]);
}
