-- CreateTable
CREATE TABLE "SourceInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "configJson" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Checkpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceInstanceId" TEXT NOT NULL,
    "cursor" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Checkpoint_sourceInstanceId_fkey" FOREIGN KEY ("sourceInstanceId") REFERENCES "SourceInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceInstanceId" TEXT NOT NULL,
    "triggerKind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "createdEntryCount" INTEGER NOT NULL DEFAULT 0,
    "revisedEntryCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateObservationCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    CONSTRAINT "Run_sourceInstanceId_fkey" FOREIGN KEY ("sourceInstanceId") REFERENCES "SourceInstance" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Step" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "inputJson" TEXT,
    "outputJson" TEXT,
    "errorMessage" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    CONSTRAINT "Step_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT,
    "stepId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "leaseOwner" TEXT,
    "leaseToken" TEXT,
    "leaseExpiresAt" DATETIME,
    "nextAttemptAt" DATETIME,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Job_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "Step" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instanceId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL,
    "stoppedAt" DATETIME
);

-- CreateTable
CREATE TABLE "DomainEvent" (
    "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aggregateType" TEXT,
    "aggregateId" TEXT,
    "runId" TEXT,
    CONSTRAINT "DomainEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Observation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceInstanceId" TEXT NOT NULL,
    "runId" TEXT,
    "entryId" TEXT,
    "externalId" TEXT,
    "externalKey" TEXT NOT NULL,
    "externalRevision" TEXT NOT NULL DEFAULT '0',
    "eventKind" TEXT NOT NULL DEFAULT 'create',
    "sourceLocatorJson" TEXT NOT NULL,
    "discoveryContextJson" TEXT,
    "webUrl" TEXT,
    "payloadBlobKey" TEXT,
    "title" TEXT,
    "contentText" TEXT,
    "contentFingerprint" TEXT,
    "sourcePublishedAt" DATETIME,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Observation_sourceInstanceId_fkey" FOREIGN KEY ("sourceInstanceId") REFERENCES "SourceInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Observation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Observation_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Entry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceInstanceId" TEXT NOT NULL,
    "canonicalExternalId" TEXT NOT NULL,
    "currentRevisionId" TEXT,
    "storyId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Entry_sourceInstanceId_fkey" FOREIGN KEY ("sourceInstanceId") REFERENCES "SourceInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Entry_currentRevisionId_fkey" FOREIGN KEY ("currentRevisionId") REFERENCES "EntryRevision" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Entry_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EntryRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entryId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "contentText" TEXT NOT NULL,
    "contentFingerprint" TEXT NOT NULL,
    "webUrl" TEXT,
    "sourcePublishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EntryRevision_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entryRevisionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "storageKey" TEXT,
    "mimeType" TEXT,
    "byteSize" INTEGER,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Asset_entryRevisionId_fkey" FOREIGN KEY ("entryRevisionId") REFERENCES "EntryRevision" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Story" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "subtype" TEXT,
    "currentRevisionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Story_currentRevisionId_fkey" FOREIGN KEY ("currentRevisionId") REFERENCES "StoryRevision" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StoryRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryRevision_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Checkpoint_sourceInstanceId_key" ON "Checkpoint"("sourceInstanceId");

-- CreateIndex
CREATE INDEX "Run_sourceInstanceId_createdAt_idx" ON "Run"("sourceInstanceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Step_runId_position_key" ON "Step"("runId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Job_idempotencyKey_key" ON "Job"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Job_status_nextAttemptAt_idx" ON "Job"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerHeartbeat_instanceId_key" ON "WorkerHeartbeat"("instanceId");

-- CreateIndex
CREATE UNIQUE INDEX "DomainEvent_eventId_key" ON "DomainEvent"("eventId");

-- CreateIndex
CREATE INDEX "DomainEvent_occurredAt_idx" ON "DomainEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "Observation_sourceInstanceId_externalKey_capturedAt_idx" ON "Observation"("sourceInstanceId", "externalKey", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Observation_sourceInstanceId_runId_externalKey_key" ON "Observation"("sourceInstanceId", "runId", "externalKey");

-- CreateIndex
CREATE UNIQUE INDEX "Entry_currentRevisionId_key" ON "Entry"("currentRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "Entry_sourceInstanceId_canonicalExternalId_key" ON "Entry"("sourceInstanceId", "canonicalExternalId");

-- CreateIndex
CREATE INDEX "EntryRevision_entryId_createdAt_idx" ON "EntryRevision"("entryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EntryRevision_entryId_revision_key" ON "EntryRevision"("entryId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "Story_currentRevisionId_key" ON "Story"("currentRevisionId");
