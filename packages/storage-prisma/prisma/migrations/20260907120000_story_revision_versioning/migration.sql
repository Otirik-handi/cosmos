-- AlterTable: StoryRevision versioning (revision number + optional fingerprint)
-- Backfill: per-story revision numbers ordered by createdAt/id; fingerprint stays NULL for legacy rows.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_StoryRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "fingerprint" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryRevision_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_StoryRevision" ("createdAt", "id", "storyId", "title", "summary")
SELECT "createdAt", "id", "storyId", "title", "summary" FROM "StoryRevision";
UPDATE "new_StoryRevision" SET "revision" = (
    SELECT COUNT(*) FROM "new_StoryRevision" AS s
    WHERE s."storyId" = "new_StoryRevision"."storyId"
      AND (s."createdAt" < "new_StoryRevision"."createdAt"
           OR (s."createdAt" = "new_StoryRevision"."createdAt" AND s."id" <= "new_StoryRevision"."id"))
);
DROP TABLE "StoryRevision";
ALTER TABLE "new_StoryRevision" RENAME TO "StoryRevision";
CREATE UNIQUE INDEX "StoryRevision_storyId_revision_key" ON "StoryRevision"("storyId", "revision");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
