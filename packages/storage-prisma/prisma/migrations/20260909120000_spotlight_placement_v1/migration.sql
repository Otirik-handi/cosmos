-- CreateTable: SpotlightPlacement (manual spotlight pin bound to one board;
-- shares the placement contract with the future automatic policy, v1 writes
-- only source=manual/expiresAt=null; ADR-0010 decision 3)
CREATE TABLE "SpotlightPlacement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "boardId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "reason" TEXT,
    "actorJson" TEXT,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SpotlightPlacement_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SpotlightPlacement_boardId_targetType_targetId_key" ON "SpotlightPlacement"("boardId", "targetType", "targetId");

CREATE INDEX "SpotlightPlacement_boardId_idx" ON "SpotlightPlacement"("boardId");

CREATE INDEX "SpotlightPlacement_targetType_targetId_idx" ON "SpotlightPlacement"("targetType", "targetId");
