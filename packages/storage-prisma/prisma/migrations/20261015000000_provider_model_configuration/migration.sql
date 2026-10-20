-- Additive Task 39 storage only. Existing Connection credentials remain untouched.
CREATE TABLE "ModelProvider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "api" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "secretRef" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "state" TEXT NOT NULL DEFAULT 'active',
    "pendingOperationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "ModelProvider_secretRef_key" ON "ModelProvider"("secretRef");
CREATE UNIQUE INDEX "ModelProvider_pendingOperationId_key" ON "ModelProvider"("pendingOperationId");

CREATE TABLE "ConfiguredModel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contextWindow" INTEGER NOT NULL,
    "maxOutputTokens" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ConfiguredModel_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ModelProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ConfiguredModel_providerId_modelId_key" ON "ConfiguredModel"("providerId", "modelId");

-- No Provider FK: non-secret operation receipts survive final Provider deletion.
CREATE TABLE "ModelConfigurationOperation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "idempotencyKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "phase" TEXT NOT NULL DEFAULT 'registered',
    "generation" INTEGER NOT NULL DEFAULT 1,
    "expectedVersion" INTEGER,
    "resourceVersion" INTEGER,
    "newSecretRef" TEXT,
    "oldSecretRef" TEXT,
    "errorCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "ModelConfigurationOperation_idempotencyKey_key" ON "ModelConfigurationOperation"("idempotencyKey");
CREATE UNIQUE INDEX "ModelConfigurationOperation_newSecretRef_key" ON "ModelConfigurationOperation"("newSecretRef");
CREATE INDEX "ModelConfigurationOperation_providerId_state_idx" ON "ModelConfigurationOperation"("providerId", "state");

-- SQLite permits an optional REFERENCES column without rebuilding the existing table.
ALTER TABLE "ConnectionInstance" ADD COLUMN "modelId" TEXT REFERENCES "ConfiguredModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConnectionInstance" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
CREATE INDEX "ConnectionInstance_modelId_idx" ON "ConnectionInstance"("modelId");
