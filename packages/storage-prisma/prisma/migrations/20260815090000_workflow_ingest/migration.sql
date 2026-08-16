-- Add durable checkpoint CAS state for Workflow ingest.
ALTER TABLE "Checkpoint" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Checkpoint" ADD COLUMN "workflowRunId" TEXT;
CREATE INDEX "Checkpoint_workflowRunId_idx" ON "Checkpoint"("workflowRunId");

-- Preserve workflow provenance and idempotency for domain observations.
ALTER TABLE "Observation" ADD COLUMN "workflowRunId" TEXT;
ALTER TABLE "Observation" ADD COLUMN "ingestCommandId" TEXT;
CREATE UNIQUE INDEX "Observation_ingestCommandId_key" ON "Observation"("ingestCommandId");
ALTER TABLE "Observation" ADD COLUMN "ingestResultJson" TEXT;
CREATE INDEX "Observation_workflowRunId_capturedAt_idx" ON "Observation"("workflowRunId", "capturedAt");
