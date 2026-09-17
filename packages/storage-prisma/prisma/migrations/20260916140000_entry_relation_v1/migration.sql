-- CreateTable: EntryRelation (cross-source duplicate/syndication relation between
-- two Entries; keys on the Entry content identity, so Story merge/split never
-- rewrites it and deleting an Entry cascades; ADR-0022 decisions 2-4).
-- Symmetric types are stored in Entry-id order, which is what makes the unique
-- key below a key on the unordered pair.
CREATE TABLE "EntryRelation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromEntryId" TEXT NOT NULL,
    "toEntryId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "producer" TEXT NOT NULL DEFAULT 'human',
    "producerVersion" TEXT,
    "confidence" REAL NOT NULL DEFAULT 1,
    "evidence" TEXT,
    "actorJson" TEXT,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EntryRelation_fromEntryId_fkey" FOREIGN KEY ("fromEntryId") REFERENCES "Entry" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EntryRelation_toEntryId_fkey" FOREIGN KEY ("toEntryId") REFERENCES "Entry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "EntryRelation_fromEntryId_toEntryId_key" ON "EntryRelation"("fromEntryId", "toEntryId");
CREATE INDEX "EntryRelation_toEntryId_idx" ON "EntryRelation"("toEntryId");
