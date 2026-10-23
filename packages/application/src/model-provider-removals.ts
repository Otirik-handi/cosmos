import { z } from "zod";

import type { SecretStorePort } from "./secret-store.js";

/**
 * 删除只在「没有任何连接引用它的模型」时才成立。判定必须在与删除同一个事务里完成：
 * 先查后另事务提交会放过「查完之后新建的连接」。
 */
export interface ModelProviderRemovalRepository {
    /** 成功返回该 Provider 的凭证 ref（可能为空）；失败用 `{ code }` 报固定错误。 */
    remove(input: { id: string; expectedVersion: number }): Promise<string | null>;
}

const identifier = z.string().min(1).max(200).refine((value) => value === value.trim() && !/[\x00-\x1f\x7f]/.test(value));

type RemovalFailureCode = "invalid_input" | "not_found" | "in_use" | "version_conflict" | "operation_in_progress" | "dependency_unavailable";

function fail(code: RemovalFailureCode): never {
    throw Object.assign(new Error("Model provider removal failed."), { code });
}

/** 只有已经分类过的错误码才过边界；其余一律当作可重试的依赖故障。 */
function safeFailure(error: unknown): never {
    let code: RemovalFailureCode = "dependency_unavailable";
    try {
        const candidate: unknown = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
        if (candidate === "not_found" || candidate === "in_use" || candidate === "version_conflict" || candidate === "operation_in_progress") {
            code = candidate;
        }
    } catch {
        // 依赖错误自身的访问器也可能抛，不能让它的异常越过边界。
    }
    return fail(code);
}

export class ModelProviderRemovals {
    constructor(private readonly dependencies: {
        repository: ModelProviderRemovalRepository;
        secrets: Pick<SecretStorePort, "delete">;
        /** 凭证文件删除失败时只记日志：行已经删掉，残留文件是可清理的垃圾，不该让删除显示为失败。 */
        onCleanupFailure?: (input: { secretRef: string; error: unknown }) => void;
    }) {}

    async remove(providerId: string, expectedVersion: number): Promise<void> {
        if (!identifier.safeParse(providerId).success) fail("invalid_input");
        if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) fail("invalid_input");
        let secretRef: string | null;
        try {
            secretRef = await this.dependencies.repository.remove({ id: providerId, expectedVersion });
        } catch (error) {
            return safeFailure(error);
        }
        if (secretRef === null) return;
        try {
            await this.dependencies.secrets.delete(secretRef);
        } catch (error) {
            this.dependencies.onCleanupFailure?.({ secretRef, error });
        }
    }
}
