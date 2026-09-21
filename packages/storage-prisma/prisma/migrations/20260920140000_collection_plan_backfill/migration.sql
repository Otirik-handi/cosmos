-- CollectionPlan (ADR-0023 decision 2, backfill step): every existing source gets
-- one default plan that inherits its connection, media budget and enabled state,
-- and the existing Run/WorkflowRun/Checkpoint/TriggerBinding rows are pointed at
-- that plan so history can answer "which plan did this belong to" after the read
-- switch. This step only writes the new plan columns: the source-keyed read path
-- is still authoritative, so SourceInstance.config, SourceInstance.connectionId
-- and the connector-state namespaces are left untouched until the read switch.
-- Plan ids are derived from the source id so the mapping is reproducible.
INSERT INTO "CollectionPlan" ("id", "name", "sourceId", "connectionId", "mediaPolicyJson", "overlapPolicy", "enabled", "revision", "createdAt", "updatedAt")
SELECT
    'plan:' || "id",
    "name",
    "id",
    "connectionId",
    json_extract("configJson", '$.media'),
    'forbid',
    -- 墓碑来源（AUT-001）的计划不可执行：来源行可能仍留着 enabled=1。
    CASE WHEN "deletedAt" IS NULL THEN "enabled" ELSE 0 END,
    1,
    "createdAt",
    "updatedAt"
FROM "SourceInstance";

UPDATE "Run"
SET "planId" = (SELECT "id" FROM "CollectionPlan" WHERE "CollectionPlan"."sourceId" = "Run"."sourceInstanceId")
WHERE "planId" IS NULL;

UPDATE "WorkflowRun"
SET "planId" = (SELECT "id" FROM "CollectionPlan" WHERE "CollectionPlan"."sourceId" = "WorkflowRun"."sourceInstanceId")
WHERE "planId" IS NULL AND "sourceInstanceId" IS NOT NULL;

UPDATE "Checkpoint"
SET "planId" = (SELECT "id" FROM "CollectionPlan" WHERE "CollectionPlan"."sourceId" = "Checkpoint"."sourceInstanceId")
WHERE "planId" IS NULL;

UPDATE "TriggerBinding"
SET "planId" = (SELECT "id" FROM "CollectionPlan" WHERE "CollectionPlan"."sourceId" = "TriggerBinding"."sourceId")
WHERE "planId" IS NULL;
