-- 连接承载适配器的非秘密配置（Proposal connection-login-lifecycle-v1 决定 1）：
-- OpenCLI profile 从 SourceInstance.config 搬到 ConnectionInstance.configJson。
-- 本迁移做三段式里的 expand + backfill（加列、按 profile 建连接、计划指向它、再从
-- 来源配置移除）；read switch 是同批的代码改动。
--
-- 去重只靠确定性 id：`configJson` 是本迁移才加的列，所以迁移前不可能存在「已带 profile
-- 的连接」可以复用；同一 profile 的多个来源因此必然收敛到同一条连接。`INSERT OR IGNORE`
-- 让这一步可重跑，`WHERE "connectionId" IS NULL` 让用户的显式绑定优先，`json_remove` 幂等。
ALTER TABLE "ConnectionInstance" ADD COLUMN "configJson" TEXT;

-- 1) 每个 live 来源配置里的 profile 一条连接。
INSERT OR IGNORE INTO "ConnectionInstance" (
    "id", "name", "connectorId", "account", "scopeJson", "configJson",
    "status", "secretRef", "lastError", "createdAt", "updatedAt"
)
SELECT
    'connection:bilibili:' || profiles."profile",
    'Bilibili ' || profiles."profile",
    'bilibili',
    NULL,
    NULL,
    json_object('profile', profiles."profile"),
    'active',
    NULL,
    NULL,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT json_extract("configJson", '$.profile') AS "profile"
    FROM "SourceInstance"
    WHERE "deletedAt" IS NULL
      AND json_extract("configJson", '$.profile') IS NOT NULL
) AS profiles;

-- 2) 计划补上连接绑定。profile 是连接的配置，绑定只是计划指向它。
UPDATE "CollectionPlan"
SET "connectionId" = (
    SELECT connection."id" FROM "ConnectionInstance" AS connection
    WHERE connection."connectorId" = 'bilibili'
      AND json_extract(connection."configJson", '$.profile') = (
          SELECT json_extract(source."configJson", '$.profile')
          FROM "SourceInstance" AS source
          WHERE source."id" = "CollectionPlan"."sourceId"
      )
)
WHERE "connectionId" IS NULL
  AND (
      SELECT json_extract(source."configJson", '$.profile')
      FROM "SourceInstance" AS source
      WHERE source."id" = "CollectionPlan"."sourceId"
        AND source."deletedAt" IS NULL
  ) IS NOT NULL;

-- 3) 来源配置不再承载 profile：同一份事实只能有一个所有者。墓碑记录是历史，不改写。
UPDATE "SourceInstance"
SET "configJson" = json_remove("configJson", '$.profile')
WHERE "deletedAt" IS NULL
  AND json_extract("configJson", '$.profile') IS NOT NULL;
