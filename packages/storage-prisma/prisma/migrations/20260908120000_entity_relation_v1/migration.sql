-- CreateTable: Entity/Relation v1 (Entity + versioned Revision + Alias, Story↔Entity link, Entity↔Entity relation)
CREATE TABLE "Entity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "currentRevisionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable: EntityRevision (immutable display revision of name/type; fingerprint marks no-op updates)
CREATE TABLE "EntityRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "fingerprint" TEXT,
    "actorJson" TEXT,
    "reason" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EntityRevision_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: EntityAlias (name alias for resolving alternate spellings; discrete add/remove, not revisioned)
CREATE TABLE "EntityAlias" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EntityAlias_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: StoryEntity (one current Story↔Entity link with provenance fields)
CREATE TABLE "StoryEntity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "producer" TEXT NOT NULL DEFAULT 'human',
    "producerVersion" TEXT,
    "confidence" REAL NOT NULL DEFAULT 1,
    "evidence" TEXT,
    "actorJson" TEXT,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StoryEntity_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoryEntity_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: EntityRelation (one directed Entity↔Entity typed relation with provenance fields)
CREATE TABLE "EntityRelation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromEntityId" TEXT NOT NULL,
    "toEntityId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "producer" TEXT NOT NULL DEFAULT 'human',
    "producerVersion" TEXT,
    "confidence" REAL NOT NULL DEFAULT 1,
    "evidence" TEXT,
    "actorJson" TEXT,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EntityRelation_fromEntityId_fkey" FOREIGN KEY ("fromEntityId") REFERENCES "Entity" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EntityRelation_toEntityId_fkey" FOREIGN KEY ("toEntityId") REFERENCES "Entity" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Entity_currentRevisionId_key" ON "Entity"("currentRevisionId");
CREATE UNIQUE INDEX "EntityRevision_entityId_revision_key" ON "EntityRevision"("entityId", "revision");
CREATE UNIQUE INDEX "EntityAlias_entityId_name_key" ON "EntityAlias"("entityId", "name");
CREATE UNIQUE INDEX "StoryEntity_storyId_entityId_key" ON "StoryEntity"("storyId", "entityId");
CREATE UNIQUE INDEX "EntityRelation_fromEntityId_toEntityId_relationType_key" ON "EntityRelation"("fromEntityId", "toEntityId", "relationType");
