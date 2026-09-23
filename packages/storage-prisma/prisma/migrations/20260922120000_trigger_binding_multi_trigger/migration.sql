-- TriggerBinding 多触发器（ADR-0025）：唯一约束从「每来源／计划一行」改为
-- 「每来源／计划、每种类型一行」，让同一个计划可以同时持有 schedule 与 webhook
-- 触发器。迁移前每个来源至多一行，所以既有数据不变；这是索引级操作，不重建表。
DROP INDEX "TriggerBinding_sourceId_key";
DROP INDEX "TriggerBinding_planId_key";

CREATE UNIQUE INDEX "TriggerBinding_sourceId_kind_key" ON "TriggerBinding"("sourceId", "kind");
CREATE UNIQUE INDEX "TriggerBinding_planId_kind_key" ON "TriggerBinding"("planId", "kind");
