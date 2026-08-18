-- Preserve the source projection for durable Workflow Runs. Existing rows remain nullable.
ALTER TABLE "WorkflowRun" ADD COLUMN "sourceInstanceId" TEXT;
ALTER TABLE "WorkflowRun" ADD COLUMN "errorMessage" TEXT;
CREATE INDEX "WorkflowRun_sourceInstanceId_createdAt_idx" ON "WorkflowRun"("sourceInstanceId", "createdAt");
CREATE INDEX "WorkflowRun_sourceInstanceId_idx" ON "WorkflowRun"("sourceInstanceId");
