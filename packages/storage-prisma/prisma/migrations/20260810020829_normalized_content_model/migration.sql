-- AlterTable
ALTER TABLE "Entry" ADD COLUMN "metricsJson" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_EntryRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entryId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "contentText" TEXT NOT NULL,
    "contentFingerprint" TEXT NOT NULL,
    "webUrl" TEXT,
    "contentKind" TEXT NOT NULL DEFAULT 'article',
    "publisherJson" TEXT,
    "publishedAtJson" TEXT,
    "updatedAtJson" TEXT,
    "sourcePublishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EntryRevision_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_EntryRevision" ("contentFingerprint", "contentText", "createdAt", "entryId", "id", "revision", "sourcePublishedAt", "summary", "title", "webUrl") SELECT "contentFingerprint", "contentText", "createdAt", "entryId", "id", "revision", "sourcePublishedAt", "summary", "title", "webUrl" FROM "EntryRevision";
DROP TABLE "EntryRevision";
ALTER TABLE "new_EntryRevision" RENAME TO "EntryRevision";
CREATE INDEX "EntryRevision_entryId_createdAt_idx" ON "EntryRevision"("entryId", "createdAt");
CREATE UNIQUE INDEX "EntryRevision_entryId_revision_key" ON "EntryRevision"("entryId", "revision");
CREATE TABLE "new_Observation" (
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
    "contentKind" TEXT NOT NULL DEFAULT 'article',
    "publisherJson" TEXT,
    "metricsJson" TEXT,
    "publishedAtJson" TEXT,
    "updatedAtJson" TEXT,
    "sourcePublishedAt" DATETIME,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Observation_sourceInstanceId_fkey" FOREIGN KEY ("sourceInstanceId") REFERENCES "SourceInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Observation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Observation_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Observation" ("capturedAt", "contentFingerprint", "contentText", "discoveryContextJson", "entryId", "eventKind", "externalId", "externalKey", "externalRevision", "id", "payloadBlobKey", "runId", "sourceInstanceId", "sourceLocatorJson", "sourcePublishedAt", "title", "webUrl") SELECT "capturedAt", "contentFingerprint", "contentText", "discoveryContextJson", "entryId", "eventKind", "externalId", "externalKey", "externalRevision", "id", "payloadBlobKey", "runId", "sourceInstanceId", "sourceLocatorJson", "sourcePublishedAt", "title", "webUrl" FROM "Observation";
DROP TABLE "Observation";
ALTER TABLE "new_Observation" RENAME TO "Observation";
CREATE INDEX "Observation_sourceInstanceId_externalKey_capturedAt_idx" ON "Observation"("sourceInstanceId", "externalKey", "capturedAt");
CREATE UNIQUE INDEX "Observation_sourceInstanceId_runId_externalKey_key" ON "Observation"("sourceInstanceId", "runId", "externalKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
