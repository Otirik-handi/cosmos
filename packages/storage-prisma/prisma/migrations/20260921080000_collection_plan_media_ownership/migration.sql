-- CollectionPlan (ADR-0023 decision 2, read switch): the media budget's owner
-- moves from the source config to the plan, and the source-side copy is removed
-- so the same fact cannot live in two places while only the plan is read.
--
-- Order matters: carry the last recorded intent into the plan first, then strip
-- the source copy. The backfill seeded plan.mediaPolicyJson from config.media and
-- the 1c-1c-a write-through kept it in sync since, so this sync is a safety net
-- rather than a data move — but running it before the removal makes the migration
-- correct on its own, without depending on that history.
UPDATE "CollectionPlan"
SET "mediaPolicyJson" = (
    SELECT json_extract("configJson", '$.media') FROM "SourceInstance"
    WHERE "SourceInstance"."id" = "CollectionPlan"."sourceId"
)
WHERE EXISTS (
    SELECT 1 FROM "SourceInstance"
    WHERE "SourceInstance"."id" = "CollectionPlan"."sourceId"
      AND json_extract("SourceInstance"."configJson", '$.media') IS NOT NULL
);

-- json_extract yields SQL NULL for an absent key, so a source with no media
-- policy lands on NULL — "follow the global default", not an empty policy.
UPDATE "SourceInstance"
SET "configJson" = json_remove("configJson", '$.media')
WHERE json_extract("configJson", '$.media') IS NOT NULL;
