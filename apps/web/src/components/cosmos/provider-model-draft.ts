import {
    createConfiguredModelCommandSchema,
    createModelProviderCommandSchema,
    updateModelProviderCommandSchema,
    type CreateConfiguredModelCommand,
    type CreateModelProviderCommand,
    type ModelProviderOperationSnapshot,
    type ModelProviderSnapshot,
    type ProviderModelDiscoveryCandidate,
    type ProviderModelDiscoveryErrorCode,
    type UpdateModelProviderCommand,
} from "@cosmos/contracts";

/**
 * 模型页的表单只有一套判据：合同 schema。这里不重复写校验规则，只负责三件界面才关心的事——
 * 哪些空白要裁（名称、地址）而哪些不能裁（凭证）、编辑时怎么算出「真的改了什么」、
 * 以及把校验失败落到具体字段上。
 *
 * 逻辑放在 `.ts` 而不是组件里，是因为仓库没有 DOM 测试环境：这些判据要能被行为测试直接钉住。
 */

export type ProviderFormValues = {
    name: string;
    api: "openai-completions" | "openai-responses";
    baseUrl: string;
    /** 空字符串表示「不修改已保存的凭证」；创建时必填。 */
    apiKey: string;
};

export type ProviderFormField = "name" | "api" | "baseUrl" | "apiKey";
/** `form` 是整体性拒绝，没有可定位的字段。 */
export type ProviderFormErrors = Partial<Record<ProviderFormField | "form", string>>;

export type DraftResult<TCommand> =
    | { ok: true; command: TCommand }
    | { ok: false; errors: ProviderFormErrors };

const issueReasons: Record<string, string> = {
    name: "name",
    api: "protocol",
    baseUrl: "address",
    apiKey: "credential",
};

function errorsFromIssues(issues: readonly { path: readonly PropertyKey[] }[]): ProviderFormErrors {
    const errors: ProviderFormErrors = {};
    for (const issue of issues) {
        const field = String(issue.path[0] ?? "");
        const reason = issueReasons[field];
        if (reason !== undefined && errors[field as ProviderFormField] === undefined) {
            errors[field as ProviderFormField] = reason;
        }
    }
    return errors;
}

function trimmedProvider(values: ProviderFormValues): ProviderFormValues {
    return {
        name: values.name.trim(),
        api: values.api,
        baseUrl: values.baseUrl.trim(),
        // 凭证两端空白可能是密钥本体的一部分，裁掉就等于改了密钥。
        apiKey: values.apiKey,
    };
}

export function toCreateProviderCommand(values: ProviderFormValues): DraftResult<CreateModelProviderCommand> {
    const parsed = createModelProviderCommandSchema.safeParse(trimmedProvider(values));
    return parsed.success
        ? { ok: true, command: parsed.data }
        : { ok: false, errors: errorsFromIssues(parsed.error.issues) };
}

export type StoredProvider = {
    name: string;
    api: ProviderFormValues["api"];
    baseUrl: string;
};

/**
 * 编辑只提交与已保存值不同的字段：不变的字段不进请求，就不会因为界面里的一次误触
 * 把 Provider 版本推高一格。留空的凭证表示保留原值——用户无法读出已保存的 key，
 * 所以「空 = 不改」是唯一不会把凭证删掉的解释。
 */
export function toUpdateProviderCommand(
    expectedVersion: number,
    stored: StoredProvider,
    values: ProviderFormValues,
): DraftResult<UpdateModelProviderCommand> {
    const next = trimmedProvider(values);
    const changed: Record<string, string | number> = { expectedVersion };
    if (next.name !== stored.name) changed.name = next.name;
    if (next.api !== stored.api) changed.api = next.api;
    if (next.baseUrl !== stored.baseUrl) changed.baseUrl = next.baseUrl;
    if (next.apiKey.trim() !== "") changed.apiKey = next.apiKey;

    if (Object.keys(changed).length === 1) {
        return { ok: false, errors: { form: "unchanged" } };
    }

    const parsed = updateModelProviderCommandSchema.safeParse(changed);
    return parsed.success
        ? { ok: true, command: parsed.data }
        : { ok: false, errors: errorsFromIssues(parsed.error.issues) };
}

export type ModelDraftValues = {
    modelId: string;
    name: string;
    contextWindow: string;
    maxOutputTokens: string;
};

export type ModelFormField = keyof ModelDraftValues;
export type ModelFormErrors = Partial<Record<ModelFormField | "form", string>>;

const modelIssueReasons: Record<string, string> = {
    modelId: "modelId",
    name: "name",
    contextWindow: "contextWindow",
    maxOutputTokens: "maxOutputTokens",
};

/** 数字输入框给的是字符串；空串与小数都要在提交前被拒，而不是 Number() 后变成 NaN 或 0。 */
function toBudget(value: string): number | null {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function toCreateModelCommand(values: ModelDraftValues): DraftResult<CreateConfiguredModelCommand> {
    const parsed = createConfiguredModelCommandSchema.safeParse({
        modelId: values.modelId.trim(),
        name: values.name.trim(),
        contextWindow: toBudget(values.contextWindow),
        maxOutputTokens: toBudget(values.maxOutputTokens),
    });
    if (parsed.success) return { ok: true, command: parsed.data };

    const errors: ModelFormErrors = {};
    for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? "");
        const reason = modelIssueReasons[field];
        if (reason !== undefined && errors[field as ModelFormField] === undefined) {
            errors[field as ModelFormField] = reason;
        }
    }
    return { ok: false, errors };
}

export type CandidateOption = ProviderModelDiscoveryCandidate & { configured: boolean };

/** 已配置的候选仍然留在列表里并标出来：隐藏它们会让用户以为上游已经没有这个模型。 */
export function candidateOptions(
    candidates: readonly ProviderModelDiscoveryCandidate[],
    configuredModelIds: readonly string[],
): CandidateOption[] {
    const configured = new Set(configuredModelIds);
    return candidates.map((candidate) => ({
        modelId: candidate.modelId,
        name: candidate.name,
        configured: configured.has(candidate.modelId),
    }));
}

export type DiscoveryNotice =
    | { kind: "found"; count: number }
    | { kind: "empty" }
    | { kind: "failed"; reason: "authentication" | "unsupported" | "timeout" | "tooLarge" | "malformed" | "unreachable" };

export type DiscoveryOutcome =
    | { status: "succeeded"; count: number }
    | { status: "failed"; errorCode: ProviderModelDiscoveryErrorCode };

const failureReasons: Record<ProviderModelDiscoveryErrorCode, DiscoveryNotice | null> = {
    authentication_failed: { kind: "failed", reason: "authentication" },
    unsupported: { kind: "failed", reason: "unsupported" },
    timeout: { kind: "failed", reason: "timeout" },
    response_too_large: { kind: "failed", reason: "tooLarge" },
    malformed_response: { kind: "failed", reason: "malformed" },
    dependency_unavailable: { kind: "failed", reason: "unreachable" },
    // 上游回了空列表和「上游没有可用模型」是同一件事，不必分成两句。
    empty_result: { kind: "empty" },
};

export function discoveryNotice(outcome: DiscoveryOutcome): DiscoveryNotice {
    if (outcome.status === "succeeded") {
        return outcome.count === 0 ? { kind: "empty" } : { kind: "found", count: outcome.count };
    }
    return failureReasons[outcome.errorCode] ?? { kind: "failed", reason: "unreachable" };
}

/**
 * 写操作失败的分级：界面必须能区分「你改慢了」「凭证没写进去」「服务暂时不可用」，
 * 因为恢复动作完全不同（重读再保存 / 再点一次让其补偿 / 稍后重试）。
 * 判据只来自 HTTP 状态与固定错误码，不回显服务端正文。
 */
export type WriteFailureNotice =
    | "versionConflict"
    | "credentialMissing"
    | "operationInProgress"
    | "cleanupPending"
    | "credentialWriteFailed"
    | "notFound"
    | "payloadTooLarge"
    | "unavailable";

/** 只读状态码与 `body.code`：服务端正文不进界面，异常原文也不进。 */
export function writeFailureNotice(status: number, body: unknown): WriteFailureNotice {
    const code = typeof body === "object" && body !== null && "code" in body && typeof body.code === "string"
        ? body.code
        : null;
    if (code === "version_conflict") return "versionConflict";
    if (code === "credential_missing") return "credentialMissing";
    if (code === "operation_in_progress") return "operationInProgress";
    if (code === "cleanup_pending") return "cleanupPending";
    if (code === "credential_write_failed") return "credentialWriteFailed";
    if (status === 404) return "notFound";
    if (status === 413) return "payloadTooLarge";
    return "unavailable";
}
/**
 * 创建/更新的响应可能是「已存好的服务商」也可能是「还没写完的操作」：凭证写入失败或
 * 旧凭证清理未完时，服务端返回的是操作快照，而不是成功。把这件事单独建模，
 * 界面才不会把 `pending` 当成「保存成功」——那会让人以为 key 已经可用。
 */
export type ProviderWriteOutcome =
    | { kind: "saved"; provider: ModelProviderSnapshot }
    | { kind: "pending"; operation: ModelProviderOperationSnapshot }
    | { kind: "failed"; notice: WriteFailureNotice };

const operationErrorNotices: Record<string, WriteFailureNotice> = {
    credential_write_failed: "credentialWriteFailed",
    cleanup_pending: "cleanupPending",
    dependency_unavailable: "unavailable",
    version_conflict: "versionConflict",
    operation_in_progress: "operationInProgress",
};

export function providerWriteOutcome(
    result: ModelProviderSnapshot | ModelProviderOperationSnapshot,
): ProviderWriteOutcome {
    if (!("kind" in result)) {
        return { kind: "saved", provider: result };
    }
    if (result.state === "failed") {
        const notice = result.errorCode === null || result.errorCode === undefined
            ? "unavailable"
            : operationErrorNotices[result.errorCode] ?? "unavailable";
        return { kind: "failed", notice };
    }
    return { kind: "pending", operation: result };
}