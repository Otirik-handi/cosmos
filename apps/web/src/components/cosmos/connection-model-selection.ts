/**
 * 连接选择模型的纯逻辑（Proposal connection-credential-entry-v1 的「连接」一侧）：
 * 页面要在同一份连接列表里同时渲染「外部平台连接」和「模型连接」，所以「这条连接现在
 * 指向哪个模型、还找不找得到它」必须能脱离 React 判定，才好固定行为。
 */

import type {
    ConfiguredModelSnapshot, ConnectionInstance, ModelProviderSnapshot, UpdateConnectionCommand,
} from "@cosmos/contracts";
import { MODEL_CONNECTION_CONNECTOR_ID } from "@cosmos/contracts";

/** 一个可选模型：模型自身的信息 + 它所属服务商的名字（列表里要能分辨同名模型）。 */
export type ModelChoice = {
    modelId: string;
    label: string;
    providerName: string;
    providerId: string;
};

/** 服务商与它的模型一起给出一份扁平选项；顺序沿用服务商与模型各自的返回顺序。 */
export function modelChoices(
    providers: readonly ModelProviderSnapshot[],
    modelsByProvider: ReadonlyMap<string, readonly ConfiguredModelSnapshot[]>,
): readonly ModelChoice[] {
    return providers.flatMap((provider) => (modelsByProvider.get(provider.id) ?? []).map((model) => ({
        modelId: model.id,
        label: model.name,
        providerName: provider.name,
        providerId: provider.id,
    })));
}

export type ConnectionModelState =
    /** 外部平台连接：没有也不该有模型选择。 */
    | { kind: "not-model" }
    /** 模型连接还没选模型（例如先建了连接、后配模型）。 */
    | { kind: "unset" }
    | { kind: "selected"; modelId: string; label: string; providerName: string }
    /**
     * 连接指向的模型已经不在列表里：模型被删，或它所属服务商正在删除。界面必须显示
     * 「配置缺失」而不是空选择，因为这条连接在运行时是坏的。
     */
    | { kind: "missing"; modelId: string };

/**
 * 连接当前的模型选择。`missing` 与 `unset` 不能合并：前者是一个需要用户处理的坏配置，
 * 后者只是还没配。
 */
export function connectionModelState(
    connection: ConnectionInstance,
    choices: readonly ModelChoice[],
): ConnectionModelState {
    if (connection.connectorId !== MODEL_CONNECTION_CONNECTOR_ID) {
        return { kind: "not-model" };
    }
    if (connection.modelId === null) {
        return { kind: "unset" };
    }
    const found = choices.find((choice) => choice.modelId === connection.modelId);
    if (found === undefined) {
        return { kind: "missing", modelId: connection.modelId };
    }
    return {
        kind: "selected",
        modelId: found.modelId,
        label: found.label,
        providerName: found.providerName,
    };
}

/**
 * 换选命令。期望版本取自**当前读到的连接**，不是界面自己累加的数字：两个人同时换选时，
 * 后到的那次必须拿到版本冲突，而不是覆盖前一次。
 *
 * `status` 只在需要时一起带上：已撤销的连接换模型后仍是撤销状态，重新启用是单独的动作，
 * 不该被一次「换个模型看看」悄悄改掉。
 */
export function toSelectModelCommand(connection: ConnectionInstance, modelId: string): UpdateConnectionCommand {
    return { expectedVersion: connection.version, modelId };
}

/** 「这条连接上的模型还能不能用」的提示文案 key，见 `models.connection`。 */
export type ConnectionModelNotice =
    | "versionConflict"
    | "invalidSelection"
    | "notFound"
    | "unavailable";

/** 只读状态码与固定错误码：服务端正文不进界面。 */
export function connectionModelNotice(status: number, body: unknown): ConnectionModelNotice {
    const code = typeof body === "object" && body !== null && "code" in body && typeof body.code === "string"
        ? body.code
        : null;
    if (code === "version_conflict") return "versionConflict";
    if (code === "invalid_model_selection") return "invalidSelection";
    if (status === 404) return "notFound";
    return "unavailable";
}
