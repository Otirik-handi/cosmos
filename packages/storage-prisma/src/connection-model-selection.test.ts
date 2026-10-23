import { describe, expect, it } from "vitest";

import {
    ConnectionVersionConflictError,
    InvalidModelSelectionError,
} from "@cosmos/application";

import { withRepository } from "./index.fixtures.js";
import type { PrismaCosmosRepository } from "./index.js";

/**
 * 模型连接的持久化边界（API 0009「Connection 与 invocation 版本」）。
 *
 * 这里固定三件在事务里才能保证的事：版本递增挡住覆盖、模型必须仍可用、Provider
 * 正在删除时不能再被新连接或换选引用。它们都不能靠「先查后另事务写」实现。
 */
describe("model connections", () => {
    async function seed(prisma: PrismaCosmosRepository["prisma"]): Promise<{ providerId: string; modelId: string }> {
        const provider = await prisma.modelProvider.create({
            data: {
                id: "provider-a",
                name: "Synthetic Provider",
                api: "openai-completions",
                baseUrl: "https://example.invalid/v1",
            },
        });
        const model = await prisma.configuredModel.create({
            data: {
                id: "model-a",
                providerId: provider.id,
                modelId: "namespace/synthetic",
                name: "Synthetic Model",
                contextWindow: 4096,
                maxOutputTokens: 256,
            },
        });
        return { providerId: provider.id, modelId: model.id };
    }

    it("creates a model connection without a credential and reads the selection back", async () => {
        await withRepository("connection-model-create", async (repository) => {
            const { modelId } = await seed(repository.prisma);

            const created = await repository.createConnection({
                name: "对话模型",
                connectorId: "cosmos.agent",
                modelId,
            });

            expect(created).toMatchObject({
                connectorId: "cosmos.agent",
                modelId,
                secretRef: null,
                version: 1,
                status: "active",
            });
            await expect(repository.getConnection(created.id)).resolves.toMatchObject({ modelId, version: 1 });
        });
    });

    it("rejects a model connection that points at a missing model", async () => {
        await withRepository("connection-model-missing", async (repository) => {
            await seed(repository.prisma);

            await expect(repository.createConnection({
                name: "对话模型",
                connectorId: "cosmos.agent",
                modelId: "model-missing",
            })).rejects.toBeInstanceOf(InvalidModelSelectionError);
        });
    });

    it("bumps the version on every model selection change and refuses a stale one", async () => {
        await withRepository("connection-model-version", async (repository) => {
            const { modelId } = await seed(repository.prisma);
            await repository.prisma.configuredModel.create({
                data: {
                    id: "model-b",
                    providerId: "provider-a",
                    modelId: "namespace/second",
                    name: "Second",
                    contextWindow: 4096,
                    maxOutputTokens: 256,
                },
            });
            const created = await repository.createConnection({
                name: "对话模型",
                connectorId: "cosmos.agent",
                modelId,
            });

            const changed = await repository.updateConnection(created.id, {
                expectedVersion: created.version,
                modelId: "model-b",
            });
            expect(changed).toMatchObject({ modelId: "model-b", version: 2 });

            // 同一次改动用同一个期望版本再来一遍，必须失败：否则并发换选会互相覆盖。
            await expect(repository.updateConnection(created.id, {
                expectedVersion: created.version,
                modelId,
            })).rejects.toBeInstanceOf(ConnectionVersionConflictError);
        });
    });

    it("unlinks a revoked model connection but refuses an active one without a model", async () => {
        await withRepository("connection-model-unlink", async (repository) => {
            const { modelId } = await seed(repository.prisma);
            const created = await repository.createConnection({
                name: "对话模型",
                connectorId: "cosmos.agent",
                modelId,
            });

            // 还处于 active 时解除选择等于留下一条不能用的连接，必须同事务撤销。
            await expect(repository.updateConnection(created.id, {
                expectedVersion: created.version,
                modelId: null,
            })).rejects.toBeInstanceOf(InvalidModelSelectionError);

            const revoked = await repository.updateConnection(created.id, {
                expectedVersion: created.version,
                status: "revoked",
                modelId: null,
            });
            expect(revoked).toMatchObject({ modelId: null, status: "revoked", version: 2 });

            // 已 revoked 时可以省略 status 单独解除引用（换模型前腾出旧引用）。
            const reselected = await repository.updateConnection(created.id, {
                expectedVersion: revoked.version,
                modelId,
            });
            expect(reselected).toMatchObject({ modelId, version: 3 });
        });
    });

    it("refuses a model whose provider is being deleted", async () => {
        await withRepository("connection-model-deleting", async (repository) => {
            const { modelId } = await seed(repository.prisma);
            await repository.prisma.modelProvider.update({
                where: { id: "provider-a" },
                data: { state: "deleting" },
            });

            await expect(repository.createConnection({
                name: "对话模型",
                connectorId: "cosmos.agent",
                modelId,
            })).rejects.toBeInstanceOf(InvalidModelSelectionError);
        });
    });
});
