-- CreateTable: Annotation (editable user note attached to a story/entry/topic; no revision chain, ADR-0009 decision 4)
CREATE TABLE "Annotation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetRevisionId" TEXT,
    "quote" TEXT,
    "body" TEXT NOT NULL,
    "evidence" TEXT,
    "actorJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Annotation_targetType_targetId_idx" ON "Annotation"("targetType", "targetId");
