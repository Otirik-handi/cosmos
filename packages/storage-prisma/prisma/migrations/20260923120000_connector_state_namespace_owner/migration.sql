-- 命名空间归属（ING-012 的「按 Connection/Source/Workflow 范围隔离」，ADR-0026）。
-- 抽屉名是宿主按 manifest 模板算出来的字符串，之前没有任何地方记录它属于谁，所以
-- 「按连接导出」必须每次反查计划表 + 解析模板，「从抽屉名反查归属」则完全做不到。
-- 这张表把归属记成数据，查询变成一次 join。
--
-- 回填只覆盖默认模板 `{id}` 的现状：内置 manifest 的模板都是 `{id}`，而计划 id 是
-- `plan:<sourceId>`（backfill 迁移），所以现有抽屉名就等于计划 id。非默认模板写出的
-- 抽屉匹配不到，保持未归属，由宿主准备状态句柄时的首次登记补上。
CREATE TABLE "ConnectorStateNamespace" (
    "namespace" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ConnectorStateNamespace_planId_fkey" FOREIGN KEY ("planId") REFERENCES "CollectionPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ConnectorStateNamespace_planId_idx" ON "ConnectorStateNamespace"("planId");

INSERT INTO "ConnectorStateNamespace" ("namespace", "planId", "createdAt", "updatedAt")
SELECT DISTINCT cs."namespace", cp."id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "ConnectorState" cs
JOIN "CollectionPlan" cp ON cs."namespace" = cp."id"
WHERE NOT EXISTS (
    SELECT 1 FROM "ConnectorStateNamespace" n WHERE n."namespace" = cs."namespace"
);
