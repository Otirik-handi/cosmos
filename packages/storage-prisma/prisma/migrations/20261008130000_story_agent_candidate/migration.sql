-- Additive migration: Agent candidates remain reviewable until an explicit human decision.
CREATE TABLE "StoryAgentCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "storyRevisionId" TEXT NOT NULL,
    "candidateJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    "decidedBy" TEXT,
    FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "StoryAgentCandidate_storyId_createdAt_idx" ON "StoryAgentCandidate"("storyId", "createdAt");
CREATE INDEX "StoryAgentCandidate_status_createdAt_idx" ON "StoryAgentCandidate"("status", "createdAt");
