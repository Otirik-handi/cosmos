-- Additive migration: existing revisions retain legacy presentation without backfill.
CREATE TABLE "ContentRepresentation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entryRevisionId" TEXT NOT NULL,
    "representationVersion" INTEGER NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "blocksJson" TEXT NOT NULL,
    "contentText" TEXT NOT NULL,
    "qualitySignalsJson" TEXT NOT NULL,
    "supersedesRepresentationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("entryRevisionId") REFERENCES "EntryRevision" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("supersedesRepresentationId") REFERENCES "ContentRepresentation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
ALTER TABLE "EntryRevision" ADD COLUMN "evidenceObservationId" TEXT REFERENCES "Observation" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EntryRevision" ADD COLUMN "currentRepresentationId" TEXT REFERENCES "ContentRepresentation" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EntryRevision" ADD COLUMN "representationLocked" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "EntryRevision_currentRepresentationId_key" ON "EntryRevision"("currentRepresentationId");
CREATE UNIQUE INDEX "ContentRepresentation_entryRevisionId_representationVersion_key" ON "ContentRepresentation"("entryRevisionId", "representationVersion");
CREATE INDEX "ContentRepresentation_entryRevisionId_createdAt_idx" ON "ContentRepresentation"("entryRevisionId", "createdAt");
