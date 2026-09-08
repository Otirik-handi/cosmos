-- CreateTable: SavedView (named persistent query conditions, not a result snapshot; ADR-0009 decision 5)
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "text" TEXT,
    "sourceId" TEXT,
    "publishedAfter" TEXT,
    "publishedBefore" TEXT,
    "labelIdsJson" TEXT NOT NULL,
    "topicIdsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
