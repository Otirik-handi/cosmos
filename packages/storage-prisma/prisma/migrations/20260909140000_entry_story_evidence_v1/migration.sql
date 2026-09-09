-- CreateTable: EntryStoryLink (auxiliary Entry↔Story relation; Entry.storyId
-- stays the single primary-membership truth and a link never points at the
-- Entry's own primary Story; ADR-0011 decisions 1-3)
CREATE TABLE "EntryStoryLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entryId" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "producer" TEXT NOT NULL DEFAULT 'human',
    "producerVersion" TEXT,
    "confidence" REAL NOT NULL DEFAULT 1,
    "evidence" TEXT,
    "actorJson" TEXT,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EntryStoryLink_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EntryStoryLink_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "EntryStoryLink_entryId_storyId_key" ON "EntryStoryLink"("entryId", "storyId");

CREATE INDEX "EntryStoryLink_storyId_idx" ON "EntryStoryLink"("storyId");
