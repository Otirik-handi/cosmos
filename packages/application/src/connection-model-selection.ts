/**
 * 模型连接的选择规则（API 0009「Connection 与 invocation 版本」）。
 *
 * 这些规则必须和「当前连接长什么样」一起判断：换选要带上刚才读到的版本、active 的连接
 * 不能没有模型、Provider 正在删除时不能再被引用。所以判定放在这里、由存储层在同一事务里
 * 读到当前行后调用，而不是拆成「先查一遍再写一遍」。
 */

import type {
    ConnectionInstance, ConnectionStatus, UpdateConnectionCommand,
} from "@cosmos/contracts";
import { MODEL_CONNECTION_CONNECTOR_ID } from "@cosmos/contracts";

import {
    ConnectionVersionConflictError, InvalidModelSelectionError,
} from "./errors.js";

/** 命令本身不成立（缺期望版本、带上了不该出现的字段、没有要改的东西）。 */
export class ConnectionUpdateInvalidError extends Error {
    readonly code = "invalid_input" as const;

    constructor(readonly reason: string, message: string) {
        super(message);
        this.name = "ConnectionUpdateInvalidError";
    }
}

/** 模型连接可以被写成的状态：撤销是用户动作，`expired`/`error` 只由探测回写。 */
const MODEL_CONNECTION_STATUSES: readonly ConnectionStatus[] = ["active", "revoked"];

/** 模型连接的凭证属于 Provider；连接上的这些字段是所有权越界，不是可编辑项。 */
const MODEL_CONNECTION_FORBIDDEN_FIELDS = ["secretRef", "configJson", "lastError"] as const;

export type ModelConnectionWrite = {
    /** 写完之后的模型选择；`null` 表示这条连接不再引用模型。 */
    modelId: string | null;
    /** 只有选择真的换了才需要再去校验模型是否还可用。 */
    selectionChanged: boolean;
    name?: string;
    status?: ConnectionStatus;
};

/**
 * 校验一条 `cosmos.agent` 连接的更新命令，并算出要写入的字段。
 *
 * 顺序是先判「命令是否自洽」（400 类），再判「版本对不对」（409 冲突），最后判
 * 「这个选择在当前状态下成不成立」（409 选择无效）。先判版本可以避免拿旧版本覆盖别人的
 * 改动之后才发现选择其实无效。
 */
export function resolveModelConnectionWrite(
    current: ConnectionInstance,
    input: UpdateConnectionCommand,
): ModelConnectionWrite {
    if (current.connectorId !== MODEL_CONNECTION_CONNECTOR_ID) {
        // 外部平台连接的更新命令不接受模型字段：静默忽略会让调用方以为选择生效了。
        if (input.expectedVersion !== undefined || input.modelId !== undefined) {
            throw new ConnectionUpdateInvalidError(
                "not_a_model_connection",
                "Model selection fields are only accepted by model connections.",
            );
        }
        return {
            modelId: current.modelId,
            selectionChanged: false,
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
        };
    }

    if (input.expectedVersion === undefined) {
        throw new ConnectionUpdateInvalidError(
            "expected_version_required",
            "A model connection update requires expectedVersion.",
        );
    }
    for (const field of MODEL_CONNECTION_FORBIDDEN_FIELDS) {
        if (Object.hasOwn(input, field)) {
            throw new ConnectionUpdateInvalidError(
                "field_not_editable",
                `${field} is not editable on a model connection.`,
            );
        }
    }
    if (input.status !== undefined && !MODEL_CONNECTION_STATUSES.includes(input.status)) {
        throw new ConnectionUpdateInvalidError(
            "status_not_writable",
            `A model connection cannot be written as ${input.status}.`,
        );
    }
    if (input.name === undefined && input.status === undefined && input.modelId === undefined) {
        throw new ConnectionUpdateInvalidError(
            "nothing_to_update",
            "A model connection update requires name, status or modelId.",
        );
    }
    if (current.version !== input.expectedVersion) {
        throw new ConnectionVersionConflictError(current.id, input.expectedVersion);
    }

    const modelId = input.modelId === undefined ? current.modelId : input.modelId;
    const status = input.status ?? current.status;
    if (modelId === null && status === "active") {
        // 一条还生效的模型连接没有模型，等于把「当前用哪个模型」这个问题留给运行时猜。
        throw new InvalidModelSelectionError(
            "An active model connection cannot drop its model; revoke it first.",
        );
    }
    return {
        modelId,
        selectionChanged: modelId !== current.modelId,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
    };
}
