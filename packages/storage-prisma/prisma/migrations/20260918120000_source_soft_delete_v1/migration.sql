-- AddColumn: SourceInstance.deletedAt (AUT-001 source deletion).
--
-- 删除来源必须保留已录入历史：Entry.sourceInstanceId 是必填外键且 ON DELETE CASCADE，
-- 硬删来源会连带删除 Entry、Observation、EntryRevision 与 Asset，与需求验收
-- 「删除凭据、停用来源和删除历史数据是三个独立动作」冲突。因此删除落成墓碑：
-- 来源行保留（历史仍可溯源），deletedAt 非空的行从列表、读取与调度中排除。
-- expand-only：只加可空列，不回填、不改写既有数据。
ALTER TABLE "SourceInstance" ADD COLUMN "deletedAt" DATETIME;
