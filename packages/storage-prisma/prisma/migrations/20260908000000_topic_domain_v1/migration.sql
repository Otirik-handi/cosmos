-- CreateTable: Topic domain v1 (Topic + versioned Revision, Membership + revision/tombstone, Alias)
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "currentRevisionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable: TopicRevision (immutable display revision; fingerprint marks no-op updates)
CREATE TABLE "TopicRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topicId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "fingerprint" TEXT,
    "actorJson" TEXT,
    "reason" TEXT,
    "title" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "scope" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TopicRevision_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: TopicMembership (one current membership per (topic, story))
CREATE TABLE "TopicMembership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topicId" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "currentRevisionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TopicMembership_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TopicMembership_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: TopicMembershipRevision (immutable membership history; tombstone marks removal)
CREATE TABLE "TopicMembershipRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "membershipId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "role" TEXT NOT NULL,
    "reason" TEXT,
    "actorJson" TEXT,
    "tombstone" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TopicMembershipRevision_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "TopicMembership" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: TopicAlias (merge redirect from obsolete Topic id to canonical Topic id)
CREATE TABLE "TopicAlias" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "canonicalTopicId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TopicAlias_canonicalTopicId_fkey" FOREIGN KEY ("canonicalTopicId") REFERENCES "Topic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Topic_currentRevisionId_key" ON "Topic"("currentRevisionId");
CREATE UNIQUE INDEX "TopicRevision_topicId_revision_key" ON "TopicRevision"("topicId", "revision");
CREATE UNIQUE INDEX "TopicMembership_topicId_storyId_key" ON "TopicMembership"("topicId", "storyId");
CREATE UNIQUE INDEX "TopicMembership_currentRevisionId_key" ON "TopicMembership"("currentRevisionId");
CREATE UNIQUE INDEX "TopicMembershipRevision_membershipId_revision_key" ON "TopicMembershipRevision"("membershipId", "revision");
CREATE INDEX "TopicAlias_canonicalTopicId_idx" ON "TopicAlias"("canonicalTopicId");
