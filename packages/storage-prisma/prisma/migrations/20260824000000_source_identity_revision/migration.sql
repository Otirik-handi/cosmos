-- Migrate legacy connector-family kinds into explicit source definition identity.
-- Unknown kinds abort before any row is copied; no source may receive a guessed ref.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_SourceInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceDefinitionRef" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "configJson" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TEMP TRIGGER "source_instance_kind_guard"
BEFORE INSERT ON "new_SourceInstance"
WHEN NEW.kind NOT IN ('rss', 'fixture-rss', 'bilibili', 'aihot')
BEGIN
    SELECT RAISE(ABORT, 'Unknown SourceInstance.kind; migration requires an explicit mapping.');
END;

INSERT INTO "new_SourceInstance" (
    "id",
    "name",
    "kind",
    "sourceDefinitionRef",
    "operationId",
    "configJson",
    "enabled",
    "revision",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    "name",
    "kind",
    CASE "kind"
        WHEN 'rss' THEN 'source.rss@1'
        WHEN 'fixture-rss' THEN 'source.fixture-rss@1'
        WHEN 'bilibili' THEN 'source.bilibili@1'
        WHEN 'aihot' THEN 'source.aihot@1'
    END,
    'fetch',
    "configJson",
    "enabled",
    1,
    "createdAt",
    "updatedAt"
FROM "SourceInstance";

DROP TRIGGER "source_instance_kind_guard";
DROP TABLE "SourceInstance";
ALTER TABLE "new_SourceInstance" RENAME TO "SourceInstance";

CREATE TABLE "SourceActivationCommand" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceInstanceId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "baseRevisionId" TEXT NOT NULL,
    "resultRevision" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SourceActivationCommand_sourceInstanceId_fkey"
        FOREIGN KEY ("sourceInstanceId") REFERENCES "SourceInstance" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SourceActivationCommand_idempotencyKey_key"
    ON "SourceActivationCommand"("idempotencyKey");
CREATE INDEX "SourceActivationCommand_sourceInstanceId_createdAt_idx"
    ON "SourceActivationCommand"("sourceInstanceId", "createdAt");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
