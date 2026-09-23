-- Webhook 入口（ADR-0024）：TriggerBinding 增加入口标识与凭证引用。只有
-- kind = 'webhook' 的行会写这两列；既有 schedule 行保持 NULL。
-- webhookToken 唯一：入口按它定位绑定。凭证字节在 SecretStore，这里只存引用。
ALTER TABLE "TriggerBinding" ADD COLUMN "webhookToken" TEXT;
ALTER TABLE "TriggerBinding" ADD COLUMN "secretRef" TEXT;

CREATE UNIQUE INDEX "TriggerBinding_webhookToken_key" ON "TriggerBinding"("webhookToken");
