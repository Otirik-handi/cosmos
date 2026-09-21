-- CollectionPlan (ADR-0023 decisions 1-2, expand step): the user-visible collection
-- plan becomes a real object, one-to-one with its source target in v1, and owns the
-- connection anchor, the trigger, the media budget and the plan-level checkpoint so
-- two plans never share runs, errors, retries or cursors. This step is additive
-- only: the plan table is created and the plan columns are added nullable, so the
-- existing source-keyed scheduling, ingest and checkpoint path keeps working until
-- the backfill and the read switch land in later slices. No row is rewritten here.
CREATE TABLE "CollectionPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "connectionId" TEXT,
    "mediaPolicyJson" TEXT,
    "overlapPolicy" TEXT NOT NULL DEFAULT 'forbid',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CollectionPlan_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "SourceInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CollectionPlan_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ConnectionInstance" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CollectionPlan_sourceId_key" ON "CollectionPlan"("sourceId");
CREATE INDEX "CollectionPlan_connectionId_idx" ON "CollectionPlan"("connectionId");

-- 计划引用列一律可空，且不加数据库级外键：SQLite 的 ALTER TABLE 加约束受限，
-- 与既有 SourceInstance.connectionId / WorkflowRun.sourceInstanceId 同例。
ALTER TABLE "Run" ADD COLUMN "planId" TEXT;
ALTER TABLE "WorkflowRun" ADD COLUMN "planId" TEXT;
ALTER TABLE "Checkpoint" ADD COLUMN "planId" TEXT;
ALTER TABLE "TriggerBinding" ADD COLUMN "planId" TEXT;

CREATE INDEX "Run_planId_createdAt_idx" ON "Run"("planId", "createdAt");
CREATE INDEX "WorkflowRun_planId_createdAt_idx" ON "WorkflowRun"("planId", "createdAt");
CREATE UNIQUE INDEX "Checkpoint_planId_key" ON "Checkpoint"("planId");
CREATE UNIQUE INDEX "TriggerBinding_planId_key" ON "TriggerBinding"("planId");
