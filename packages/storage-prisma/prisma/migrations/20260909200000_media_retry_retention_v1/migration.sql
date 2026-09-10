-- AlterTable: media retry/retention state (ADR-0015 decisions 2/3/8).
-- Forward-only and additive with defaults; no backfill. Legacy degraded rows keep
-- a null errorCode and are treated as unknown/not retryable (no historical backfill).
ALTER TABLE "Asset" ADD COLUMN "errorCode" TEXT;
ALTER TABLE "Asset" ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Asset" ADD COLUMN "lastAttemptAt" DATETIME;

CREATE INDEX "Asset_entryRevisionId_idx" ON "Asset"("entryRevisionId");
