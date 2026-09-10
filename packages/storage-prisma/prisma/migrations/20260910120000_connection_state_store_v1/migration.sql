-- Connection/Secret/State foundations (ADR-0017). Forward-only and additive.
-- ConnectionInstance holds identity, scope, status and an opaque SecretRef; the
-- credential itself lives in the SecretStore, never in this table or Source.config.
-- ConnectorState is a namespaced + versioned non-secret KV (cursor/ETag/token/rate).
CREATE TABLE "ConnectionInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "account" TEXT,
    "scopeJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "secretRef" TEXT,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "ConnectorState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "namespace" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "valueJson" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "ConnectorState_namespace_key_key" ON "ConnectorState"("namespace", "key");

-- SourceInstance gains an optional connection anchor. Existing rows stay null
-- (unauthenticated sources); the FK is not materialized at the SQLite level
-- because ALTER TABLE cannot add a constraint, matching the existing
-- WorkflowRun.sourceInstanceId projection migration.
ALTER TABLE "SourceInstance" ADD COLUMN "connectionId" TEXT;
CREATE INDEX "SourceInstance_connectionId_idx" ON "SourceInstance"("connectionId");
