-- CollectionPlan (ADR-0023 decision 2, read switch): the enabled state's owner
-- moves from the source to the plan, and the source-side activation path is
-- removed rather than left as a second owner of the same fact.
--
-- The backfill seeded plan.enabled from the source, but users could still flip
-- sources through the source endpoint afterwards, and those writes only landed
-- on SourceInstance.enabled. Carry the last recorded intent over to the plan
-- before the switch, or the switch silently reverses the user's choice.
-- Tombstoned sources keep their plan disabled (same rule as the backfill: the
-- source row may still carry enabled=1).
UPDATE "CollectionPlan"
SET "enabled" = (
    SELECT "enabled" FROM "SourceInstance" WHERE "SourceInstance"."id" = "CollectionPlan"."sourceId"
)
WHERE EXISTS (
    SELECT 1 FROM "SourceInstance"
    WHERE "SourceInstance"."id" = "CollectionPlan"."sourceId"
      AND "SourceInstance"."deletedAt" IS NULL
);

-- The activation command table only recorded enable/disable intents for the
-- source-owned state. Enable/disable is now a plan field change guarded by the
-- plan's own revision CAS, so the table and its route are removed together.
DROP TABLE "SourceActivationCommand";
