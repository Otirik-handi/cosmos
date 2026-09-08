-- AlterTable: StoryRevision actor/reason columns
ALTER TABLE "StoryRevision" ADD COLUMN "actorJson" TEXT;
ALTER TABLE "StoryRevision" ADD COLUMN "reason" TEXT;

-- CreateTable: StoryAlias (merge redirect from obsolete Story id to canonical Story id)
CREATE TABLE "StoryAlias" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "canonicalStoryId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryAlias_canonicalStoryId_fkey" FOREIGN KEY ("canonicalStoryId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "StoryAlias_canonicalStoryId_idx" ON "StoryAlias"("canonicalStoryId");
