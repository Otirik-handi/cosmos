import { PrismaClient } from "@prisma/client";
import {
    ConnectorStateConflictError,
    type ConnectorStateEntry,
    type ConnectorStateStorePort,
} from "@cosmos/application";
import type { JsonValue } from "@notnotype/nb-workflow";

/**
 * Prisma-backed namespaced + versioned non-secret connector state (ADR-0017).
 * The `version` column is a monotonic CAS token: a put that passes a stale
 * `expectedVersion` is a conflict, so concurrent writers cannot silently drop
 * each other's cursor/ETag/token updates.
 */
export class PrismaConnectorStateStore implements ConnectorStateStorePort {
    constructor(private readonly prisma: PrismaClient) {}

    async getState(namespace: string, key: string): Promise<ConnectorStateEntry | null> {
        const row = await this.prisma.connectorState.findUnique({
            where: { namespace_key: { namespace, key } },
        });
        if (!row) return null;
        return {
            value: JSON.parse(row.valueJson) as JsonValue,
            version: row.version,
        };
    }

    async putState(
        namespace: string,
        key: string,
        value: JsonValue,
        expectedVersion: number | null,
    ): Promise<{ version: number }> {
        const valueJson = JSON.stringify(value);

        if (expectedVersion === null) {
            try {
                const row = await this.prisma.connectorState.create({
                    data: { namespace, key, valueJson, version: 1 },
                });
                return { version: row.version };
            } catch (error) {
                if (isUniqueConstraintError(error)) {
                    throw new ConnectorStateConflictError(namespace, key, null);
                }
                throw error;
            }
        }

        const updated = await this.prisma.connectorState.updateMany({
            where: { namespace, key, version: expectedVersion },
            data: { valueJson, version: expectedVersion + 1 },
        });
        if (updated.count !== 1) {
            throw new ConnectorStateConflictError(namespace, key, expectedVersion);
        }
        return { version: expectedVersion + 1 };
    }
}

function isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Error
        && "code" in error
        && (error as { code?: unknown }).code === "P2002";
}
