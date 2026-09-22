-- CollectionPlan (ADR-0023 decision 2, read switch): the connector state namespace's
-- `{id}` placeholder resolves to the collection plan instead of the source.
--
-- The manifest template semantics are unchanged (still a single `{id}` placeholder
-- declared by the operation), but its prefix now names the owner, so the default
-- moved from `source:{id}` to `plan:{id}`. Existing keys are rewritten here: state
-- is rebuildable, so the rewrite is not about correctness of the data — it avoids
-- paying for one full re-fetch per source after the switch.
--
-- v1 keeps plan and target one-to-one and plan ids are derived as `plan:<sourceId>`,
-- so the mapping needs no lookup: `source:<x>` becomes `plan:<x>`.
UPDATE "ConnectorState"
SET "namespace" = 'plan:' || substr("namespace", 8)
WHERE "namespace" LIKE 'source:%';
