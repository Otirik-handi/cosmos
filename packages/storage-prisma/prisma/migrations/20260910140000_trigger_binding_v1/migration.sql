-- TriggerBinding (ADR-0018 decision 1): promote the schedule trigger out of
-- Source.config.scheduleIntervalMs into a first-class binding. Forward-only:
-- each source that carried a schedule gets one schedule TriggerBinding and the
-- field is removed from its configJson. Sources without a schedule get none.
CREATE TABLE "TriggerBinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'schedule',
    "configJson" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TriggerBinding_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "SourceInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TriggerBinding_sourceId_key" ON "TriggerBinding"("sourceId");

INSERT INTO "TriggerBinding" ("id", "sourceId", "kind", "configJson", "enabled", "revision", "createdAt", "updatedAt")
SELECT
    'trigger:' || "id",
    "id",
    'schedule',
    json_object('intervalMs', json_extract("configJson", '$.scheduleIntervalMs')),
    "enabled",
    1,
    "createdAt",
    "updatedAt"
FROM "SourceInstance"
WHERE json_extract("configJson", '$.scheduleIntervalMs') IS NOT NULL;

UPDATE "SourceInstance"
SET "configJson" = json_remove("configJson", '$.scheduleIntervalMs')
WHERE json_extract("configJson", '$.scheduleIntervalMs') IS NOT NULL;
