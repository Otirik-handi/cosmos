-- CreateTable: Board (named dashboard root; multi-board entity with one
-- application-seeded default; ADR-0010 decisions 1 and 4)
CREATE TABLE "Board" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "Board_name_key" ON "Board"("name");

-- CreateTable: BoardSection (titled block container; no kind field, the
-- hot/curation/feed difference is carried by the block types inside)
CREATE TABLE "BoardSection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "boardId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BoardSection_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "BoardSection_boardId_idx" ON "BoardSection"("boardId");

-- CreateTable: BoardBlock (typed widget; configJson whitelist validated per
-- type; unknown types degrade to a placeholder on read)
CREATE TABLE "BoardBlock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sectionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "configJson" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BoardBlock_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "BoardSection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "BoardBlock_sectionId_idx" ON "BoardBlock"("sectionId");
