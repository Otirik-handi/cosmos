-- CreateTable: Label (global classification registry; name unique per user truth)
CREATE TABLE "Label" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable: LabelAssignment (one label attached to one story/entry/topic; no FK to target rows because the target type is polymorphic)
CREATE TABLE "LabelAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "labelId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LabelAssignment_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "Label" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: Collection (named manual set whose members are Stories, ADR-0009 decision 3)
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable: CollectionItem (one Story member of one Collection)
CREATE TABLE "CollectionItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collectionId" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CollectionItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CollectionItem_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: Favorite (one lightweight story/entry bookmark, separate from Collections)
CREATE TABLE "Favorite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Label_name_key" ON "Label"("name");
CREATE UNIQUE INDEX "LabelAssignment_labelId_targetType_targetId_key" ON "LabelAssignment"("labelId", "targetType", "targetId");
CREATE INDEX "LabelAssignment_targetType_targetId_idx" ON "LabelAssignment"("targetType", "targetId");
CREATE UNIQUE INDEX "CollectionItem_collectionId_storyId_key" ON "CollectionItem"("collectionId", "storyId");
CREATE INDEX "CollectionItem_storyId_idx" ON "CollectionItem"("storyId");
CREATE UNIQUE INDEX "Favorite_targetType_targetId_key" ON "Favorite"("targetType", "targetId");
