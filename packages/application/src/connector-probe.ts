/** 来源连通性探测与未保存配置探测。 */

import {
    getSourceConfigurationSchema, type SourceConfigProbeCommand,
    type SourceConfigProbeResult, type SourceConfig, type SourceConnectionProjection, type SourceExecutionSnapshot,
    type SourceProbeResult,
} from "@cosmos/contracts";

import type {
    CatalogPort,
} from "./catalog.js";

import {
    ConnectorExecutionError,
} from "./connector-ports.js";
import type {
    ConnectorResolver, IngestConnector,
} from "./connector-ports.js";
import {
    ConnectorRegistry,
} from "./connector-registry.js";
import {
    resolveLogger,
} from "./logger.js";
import type {
    LoggerPort,
} from "./logger.js";
import type {
    CosmosRepository,
} from "./repository-port.js";

export class ConnectorProbeService {
    private readonly logger: LoggerPort;

    constructor(
        private readonly repository: Pick<CosmosRepository, "getSource">,
        private readonly resolveConnector: ConnectorResolver,
        private readonly now: () => string = () => new Date().toISOString(),
        logger?: LoggerPort,
    ) {
        this.logger = resolveLogger(logger);
    }

    async runSource(sourceId: string): Promise<SourceProbeResult> {
        const startedAt = Date.now();
        let stage = "prepare";
        let logger = this.logger.child({ sourceId });
        try {
            const source = await this.repository.getSource(sourceId);
            if (!source) {
                throw new Error(`Source not found: ${sourceId}`);
            }
            const connector = this.resolveConnector(source);
            logger = logger.child({
                connectorId: connector.id,
            });
            logger.info("connector.probe.started", {
                sourceKind: source.kind,
            });
            stage = "validate";
            try {
                connector.validate(source);
            } catch (error) {
                logger.error("connector.validate.failed", {
                    errorCode: error instanceof ConnectorExecutionError
                        ? error.code
                        : "invalid_configuration",
                    retryable: error instanceof ConnectorExecutionError
                        ? error.retryable
                        : false,
                }, error);
                throw error;
            }
            const fetchStartedAt = Date.now();
            stage = "fetch";
            logger.debug("connector.fetch.started", {
                cursorPresent: false,
            });
            let result: Awaited<ReturnType<IngestConnector["fetchItems"]>>;
            try {
                result = await logger.withContext(
                    { sourceId, connectorId: connector.id },
                    () => connector.fetchItems({
                        source,
                        cursor: null,
                    }),
                );
            } catch (error) {
                logger.error("connector.fetch.failed", {
                    durationMs: Date.now() - fetchStartedAt,
                    errorCode: error instanceof ConnectorExecutionError
                        ? error.code
                        : null,
                    retryable: error instanceof ConnectorExecutionError
                        ? error.retryable
                        : true,
                }, error);
                throw error;
            }
            logger.info("connector.fetch.completed", {
                itemCount: result.items.length,
                nextCursorAvailable: result.nextCursor !== null,
                durationMs: Date.now() - fetchStartedAt,
            });
            logger.info("connector.probe.completed", {
                itemCount: result.items.length,
                nextCursorAvailable: result.nextCursor !== null,
                durationMs: Date.now() - startedAt,
            });
            return {
                sourceId,
                connectorId: connector.id,
                itemCount: result.items.length,
                nextCursorAvailable: result.nextCursor !== null,
                checkedAt: this.now(),
            };
        } catch (error) {
            logger.error("connector.probe.failed", {
                stage,
                durationMs: Date.now() - startedAt,
                errorCode: error instanceof ConnectorExecutionError
                    ? error.code
                    : null,
                retryable: error instanceof ConnectorExecutionError
                    ? error.retryable
                    : true,
            }, error);
            throw error;
        }
    }
}

/**
 * Dry-run probe for an unsaved source configuration. The service never
 * receives a repository, so a config probe structurally cannot persist
 * observations, entries, assets or checkpoints.
 */
export class SourceConfigProbeService {
    private readonly logger: LoggerPort;

    constructor(
        private readonly catalog: CatalogPort,
        private readonly connectors: ConnectorRegistry,
        private readonly now: () => string = () => new Date().toISOString(),
        logger?: LoggerPort,
        /**
         * 未保存配置的探测也要能读到连接的非秘密配置（Proposal connection-login-lifecycle-v1
         * 决定 1）：`feed` 这类需要登录态的操作要靠它拿到 profile。这是个只读回调——
         * 服务本身仍然拿不到仓储，所以结构上依然无法持久化 observation/entry/asset/checkpoint。
         */
        private readonly resolveConnection?: (
            connectionId: string,
        ) => Promise<SourceConnectionProjection | null>,
    ) {
        this.logger = resolveLogger(logger);
    }

    async run(command: SourceConfigProbeCommand): Promise<SourceConfigProbeResult> {
        const startedAt = Date.now();
        let stage = "prepare";
        let logger = this.logger;
        try {
            const manifest = this.catalog.getSourceDefinitionByRef(command.sourceDefinitionRef);
            if (!manifest || manifest.status !== "enabled" || !manifest.operationIds.includes(command.operationId)) {
                throw new Error(`Source definition is not available: ${command.sourceDefinitionRef}`);
            }
            // The canonical Zod schema owns config validation semantics; the
            // manifest's JSON Schema stays a descriptive projection.
            const configurationSchema = getSourceConfigurationSchema(command.sourceDefinitionRef, command.operationId);
            if (!configurationSchema) {
                throw new Error(`No canonical configuration schema is registered for ${command.sourceDefinitionRef}.`);
            }
            const config = configurationSchema.parse(command.config) as SourceConfig;
            stage = "validate";
            // `feed` 这类需要登录态的操作要靠连接（Proposal connection-login-lifecycle-v1）：
            // 给了连接却查不到是无效输入，不能悄悄降级成「没有连接」。
            const requestedConnectionId = command.connectionId ?? null;
            const connection = requestedConnectionId === null
                ? null
                : await this.resolveConnection?.(requestedConnectionId) ?? null;
            if (requestedConnectionId !== null && connection === null) {
                throw new ConnectorExecutionError(
                    "invalid_configuration",
                    `Connection not found: ${requestedConnectionId}`,
                    false,
                );
            }
            // Connectors only read config (and log kind); the remaining
            // identity fields exist to satisfy the execution snapshot without
            // inventing a persisted source row. A probe has no plan, so the
            // plan-owned fields carry sentinels — connectors must not read
            // them (they belong to the host, ADR-0023 decision 2).
            const transientSource: SourceExecutionSnapshot = {
                id: "config-probe",
                name: "(unsaved configuration)",
                sourceDefinitionRef: command.sourceDefinitionRef,
                operationId: command.operationId,
                connectorId: manifest.connectorId,
                kind: manifest.id,
                config,
                connection,
                enabled: false,
                planId: "config-probe",
                mediaPolicy: null,
                revisionId: "0",
                createdAt: this.now(),
                updatedAt: this.now(),
            };
            const connector = this.connectors.resolve(transientSource);
            logger = logger.child({ connectorId: connector.id });
            logger.info("connector.config_probe.started", {
                sourceDefinitionRef: command.sourceDefinitionRef,
                operationId: command.operationId,
            });
            try {
                connector.validate(transientSource);
            } catch (error) {
                logger.error("connector.validate.failed", {
                    errorCode: error instanceof ConnectorExecutionError
                        ? error.code
                        : "invalid_configuration",
                    retryable: error instanceof ConnectorExecutionError
                        ? error.retryable
                        : false,
                }, error);
                throw error;
            }
            stage = "fetch";
            const fetchStartedAt = Date.now();
            let result: Awaited<ReturnType<IngestConnector["fetchItems"]>>;
            try {
                result = await logger.withContext(
                    { connectorId: connector.id },
                    () => connector.fetchItems({
                        source: transientSource,
                        cursor: null,
                    }),
                );
            } catch (error) {
                logger.error("connector.fetch.failed", {
                    durationMs: Date.now() - fetchStartedAt,
                    errorCode: error instanceof ConnectorExecutionError
                        ? error.code
                        : null,
                    retryable: error instanceof ConnectorExecutionError
                        ? error.retryable
                        : true,
                }, error);
                throw error;
            }
            const sampleTitles = result.items
                .map((item) => item.title.trim())
                .filter((title) => title.length > 0)
                .slice(0, 3)
                .map((title) => title.slice(0, 200));
            logger.info("connector.config_probe.completed", {
                itemCount: result.items.length,
                nextCursorAvailable: result.nextCursor !== null,
                durationMs: Date.now() - startedAt,
            });
            return {
                sourceDefinitionRef: command.sourceDefinitionRef,
                operationId: command.operationId,
                connectorId: connector.id,
                itemCount: result.items.length,
                nextCursorAvailable: result.nextCursor !== null,
                sampleTitles,
                checkedAt: this.now(),
                durationMs: Date.now() - startedAt,
            };
        } catch (error) {
            logger.error("connector.config_probe.failed", {
                stage,
                durationMs: Date.now() - startedAt,
                errorCode: error instanceof ConnectorExecutionError
                    ? error.code
                    : null,
                retryable: error instanceof ConnectorExecutionError
                    ? error.retryable
                    : true,
            }, error);
            throw error;
        }
    }
}
