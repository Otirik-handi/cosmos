-- Additive migration: published reports and request identities remain with their original Story.
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "activeRunId" TEXT,
    "activeStartedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY ("activeRunId") REFERENCES "WorkflowRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Artifact_storyId_kind_key" ON "Artifact"("storyId", "kind");
CREATE INDEX "Artifact_activeRunId_idx" ON "Artifact"("activeRunId");

CREATE TABLE "ArtifactRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "artifactId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "headline" TEXT NOT NULL,
    "sectionsJson" TEXT NOT NULL,
    "inputJson" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "producer" TEXT NOT NULL,
    "producerVersion" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "usageJson" TEXT,
    "costJson" TEXT,
    "workflowRunId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("artifactId") REFERENCES "Artifact" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ArtifactRevision_artifactId_revision_key" ON "ArtifactRevision"("artifactId", "revision");
CREATE UNIQUE INDEX "ArtifactRevision_workflowRunId_key" ON "ArtifactRevision"("workflowRunId");

CREATE TABLE "DeepReadRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DeepReadRequest_idempotencyKey_key" ON "DeepReadRequest"("idempotencyKey");
CREATE UNIQUE INDEX "DeepReadRequest_workflowRunId_key" ON "DeepReadRequest"("workflowRunId");
CREATE INDEX "DeepReadRequest_storyId_idx" ON "DeepReadRequest"("storyId");
