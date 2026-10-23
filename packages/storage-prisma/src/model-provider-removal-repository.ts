import type { ModelProviderRemovalRepository } from "@cosmos/application";

function refuse(code: "not_found" | "in_use" | "version_conflict" | "operation_in_progress"): never {
    throw Object.assign(new Error("Model provider removal refused."), { code });
}

/**
 * 只声明用到的那几个操作：调用方传真的 Prisma client 或隔离测试生成的 client 都能满足，
 * 不需要绑死 @prisma/client 的生成类型。
 */
type RemovalTransaction = {
    modelProvider: {
        findUnique(input: { where: { id: string }; select: {
            id: true; version: true; state: true; pendingOperationId: true; secretRef: true;
        } }): Promise<{ id: string; version: number; state: string; pendingOperationId: string | null; secretRef: string | null } | null>;
        delete(input: { where: { id: string } }): Promise<unknown>;
    };
    configuredModel: {
        findMany(input: { where: { providerId: string }; select: { id: true } }): Promise<{ id: string }[]>;
        deleteMany(input: { where: { providerId: string } }): Promise<{ count: number }>;
    };
    connectionInstance: {
        count(input: { where: { modelId: { in: string[] } } }): Promise<number>;
    };
};

type RemovalClient = {
    $transaction<T>(run: (transaction: RemovalTransaction) => Promise<T>): Promise<T>;
};

/**
 * 删除 Provider 的最小形态：一个事务里判定能否删除并执行删除，凭证文件在事务外单独清理。
 *
 * 引用检查必须和删除在同一个事务里：先查后另事务提交会放过「查完之后新建的连接」，
 * 那些连接随后会指向一个不存在的模型。
 */
export class PrismaModelProviderRemovalRepository implements ModelProviderRemovalRepository {
    constructor(private readonly client: RemovalClient) {}

    remove(input: { id: string; expectedVersion: number }): Promise<string | null> {
        return this.client.$transaction(async (transaction) => {
            const provider = await transaction.modelProvider.findUnique({
                where: { id: input.id },
                select: { id: true, version: true, state: true, pendingOperationId: true, secretRef: true },
            });
            if (provider === null) refuse("not_found");
            if (provider.version !== input.expectedVersion) refuse("version_conflict");
            if (provider.state !== "active" || provider.pendingOperationId !== null) refuse("operation_in_progress");
            const models = await transaction.configuredModel.findMany({
                where: { providerId: input.id }, select: { id: true },
            });
            if (models.length > 0) {
                const used = await transaction.connectionInstance.count({
                    where: { modelId: { in: models.map((model) => model.id) } },
                });
                if (used > 0) refuse("in_use");
            }
            await transaction.configuredModel.deleteMany({ where: { providerId: input.id } });
            await transaction.modelProvider.delete({ where: { id: input.id } });
            return provider.secretRef;
        });
    }
}
