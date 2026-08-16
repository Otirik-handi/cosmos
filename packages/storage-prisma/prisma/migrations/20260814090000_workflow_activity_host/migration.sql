-- Add host envelope fields without rewriting the existing WorkflowRun table.
ALTER TABLE "WorkflowRun" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "WorkflowRun" ADD COLUMN "inputSnapshotJson" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "WorkflowRun" ADD COLUMN "productRunJson" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "WorkflowRun" ADD COLUMN "runLeaseOwner" TEXT;
ALTER TABLE "WorkflowRun" ADD COLUMN "runLeaseToken" TEXT;
ALTER TABLE "WorkflowRun" ADD COLUMN "runLeaseExpiresAt" DATETIME;
ALTER TABLE "WorkflowRun" ADD COLUMN "startedAt" DATETIME;
ALTER TABLE "WorkflowRun" ADD COLUMN "finishedAt" DATETIME;

-- Keep legacy Run/Step associations intact while allowing workflow activity jobs.
ALTER TABLE "Job" ADD COLUMN "workflowRunId" TEXT REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "WorkflowRun_idempotencyKey_key" ON "WorkflowRun"("idempotencyKey");
CREATE INDEX "Job_workflowRunId_status_idx" ON "Job"("workflowRunId", "status");

ALTER TABLE "Job" ADD COLUMN "workflowKernelRevision" INTEGER;

ALTER TABLE "DomainEvent" ADD COLUMN "workflowRunId" TEXT REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DomainEvent" ADD COLUMN "idempotencyKey" TEXT;

CREATE INDEX "Job_workflowRunId_workflowKernelRevision_idx" ON "Job"("workflowRunId", "workflowKernelRevision");
CREATE UNIQUE INDEX "DomainEvent_workflowRunId_idempotencyKey_key" ON "DomainEvent"("workflowRunId", "idempotencyKey");
CREATE TABLE "WorkflowCompletion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflowRunId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "activityKey" TEXT NOT NULL,
    "receipt" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "completionJson" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "availableAt" DATETIME NOT NULL,
    "leaseOwner" TEXT,
    "leaseToken" TEXT,
    "leaseExpiresAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkflowCompletion_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkflowCompletion_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WorkflowCompletion_jobId_key" ON "WorkflowCompletion"("jobId");
CREATE UNIQUE INDEX "WorkflowCompletion_receipt_key" ON "WorkflowCompletion"("receipt");
CREATE INDEX "WorkflowCompletion_status_availableAt_idx" ON "WorkflowCompletion"("status", "availableAt");
CREATE INDEX "WorkflowCompletion_workflowRunId_idx" ON "WorkflowCompletion"("workflowRunId");