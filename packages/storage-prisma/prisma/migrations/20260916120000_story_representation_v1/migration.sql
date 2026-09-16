-- AlterTable: Story representation extension (ADR-0021). Both columns are
-- nullable and deliberately not backfilled: an empty extension is omitted from
-- the Revision fingerprint input, so existing rows keep their fingerprint and
-- stay no-ops without a full-table fingerprint rewrite.
ALTER TABLE "StoryRevision" ADD COLUMN "timeRangeJson" TEXT;
ALTER TABLE "StoryRevision" ADD COLUMN "keyFactsJson" TEXT;
