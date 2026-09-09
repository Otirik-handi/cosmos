-- CreateTable: StoryReplacement (historical shell -> successor edge created by
-- Story split; a Story with any row here is a shell and is never an alias
-- target, so its id never redirects to a single successor; ADR-0012 decision 1)
CREATE TABLE "StoryReplacement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "successorStoryId" TEXT NOT NULL,
    "actorJson" TEXT,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryReplacement_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoryReplacement_successorStoryId_fkey" FOREIGN KEY ("successorStoryId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "StoryReplacement_storyId_successorStoryId_key" ON "StoryReplacement"("storyId", "successorStoryId");

CREATE INDEX "StoryReplacement_successorStoryId_idx" ON "StoryReplacement"("successorStoryId");
