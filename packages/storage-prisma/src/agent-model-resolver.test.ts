import { describe, expect, it } from "vitest";

import { PrismaAgentModelConnectionResolver } from "./agent-model-resolver.js";
import { withRepository } from "./index.fixtures.js";
import type { PrismaCosmosRepository } from "./index.js";

/**
 * `agent.invoke@2` 的连接解析（API 0009）：连接、模型与 Provider 必须来自同一次读取，
 * 且只有全部可用时才返回配置。返回 `null` 的每种原因都要能单独复现——否则 Worker
 * 只能笼统报"调用失败"，用户无法判断是连接撤了、模型丢了还是 Provider 在删除。
 */
describe("agent model connection resolver", () => {
    async function seed(prisma: PrismaCosmosRepository["prisma"]): Promise<{ connectionId: string; providerId: string }> {
        const provider = await prisma.modelProvider.create({
            data: {
                id: "provider-agent",
                name: "Synthetic Agent Provider",
                api: "openai-responses",
                baseUrl: "https://agent.example.invalid/v1",
                secretRef: "secret:provider-agent",
            },
        });
        const model = await prisma.configuredModel.create({
            data: {
                id: "model-agent",
                providerId: provider.id,
                modelId: "namespace/agent-model",
                name: "Synthetic Agent Model",
                contextWindow: 8_192,
                maxOutputTokens: 1_024,
            },
        });
        const connection = await prisma.connectionInstance.create({
            data: {
                id: "connection-agent",
                name: "Synthetic Agent Connection",
                connectorId: "cosmos.agent",
                status: "active",
                modelId: model.id,
            },
        });
        return { connectionId: connection.id, providerId: provider.id };
    }

    it("returns the connection, model and provider from one read", async () => {
        await withRepository("agent-model-resolve", async (repository) => {
            const { connectionId } = await seed(repository.prisma);
            const resolved = await new PrismaAgentModelConnectionResolver(repository.prisma).resolve(connectionId);

            expect(resolved).toEqual({
                connectionId: "connection-agent",
                providerId: "provider-agent",
                api: "openai-responses",
                baseUrl: "https://agent.example.invalid/v1",
                modelId: "namespace/agent-model",
                modelName: "Synthetic Agent Model",
                contextWindow: 8_192,
                maxOutputTokens: 1_024,
                secretRef: "secret:provider-agent",
            });
        });
    });

    it("refuses a revoked connection, a foreign connector and a missing model", async () => {
        await withRepository("agent-model-refuse", async (repository) => {
            const { connectionId } = await seed(repository.prisma);
            const resolver = new PrismaAgentModelConnectionResolver(repository.prisma);

            await repository.prisma.connectionInstance.update({
                where: { id: connectionId }, data: { status: "revoked" },
            });
            await expect(resolver.resolve(connectionId)).resolves.toBeNull();

            await repository.prisma.connectionInstance.update({
                where: { id: connectionId }, data: { status: "active", connectorId: "custom-auth" },
            });
            await expect(resolver.resolve(connectionId)).resolves.toBeNull();

            await repository.prisma.connectionInstance.update({
                where: { id: connectionId }, data: { connectorId: "cosmos.agent", modelId: null },
            });
            await expect(resolver.resolve(connectionId)).resolves.toBeNull();

            await expect(resolver.resolve("missing-connection")).resolves.toBeNull();
        });
    });

    it("refuses a provider that is being deleted or lost its credential reference", async () => {
        await withRepository("agent-model-provider-state", async (repository) => {
            const { connectionId, providerId } = await seed(repository.prisma);
            const resolver = new PrismaAgentModelConnectionResolver(repository.prisma);

            await repository.prisma.modelProvider.update({
                where: { id: providerId }, data: { state: "deleting" },
            });
            await expect(resolver.resolve(connectionId)).resolves.toBeNull();

            await repository.prisma.modelProvider.update({
                where: { id: providerId }, data: { state: "active", secretRef: null },
            });
            await expect(resolver.resolve(connectionId)).resolves.toBeNull();
        });
    });
});
