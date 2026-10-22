import { describe, expect, it } from "vitest";

import {
    candidateOptions,
    discoveryNotice,
    toCreateProviderCommand,
    toCreateModelCommand,
    providerWriteOutcome,
    toUpdateProviderCommand,
    writeFailureNotice,
    type ProviderFormValues,
} from "@/components/cosmos/provider-model-draft";

/**
 * 模型页的三个判据都靠纯函数钉住，因为仓库没有 DOM 测试环境：
 * 保存时「留空保留已存 key」、编辑 Provider 只提交真的改过的字段、
 * 以及发现结果只把候选当建议、已配置的模型不能被重复添加。
 */
const filled: ProviderFormValues = {
    name: "  测试服务商  ",
    api: "openai-completions",
    baseUrl: "  https://provider.example/v1  ",
    apiKey: "  synthetic-key  ",
};

const stored = {
    name: "测试服务商",
    api: "openai-completions",
    baseUrl: "https://provider.example/v1",
} as const;

describe("模型页表单", () => {
    it("创建时去掉名称与地址两端空白，但原样保留凭证", () => {
        const result = toCreateProviderCommand(filled);

        expect(result).toEqual({
            ok: true,
            command: {
                name: "测试服务商",
                api: "openai-completions",
                baseUrl: "https://provider.example/v1",
                // 凭证里的空白可能是密钥的一部分，裁掉就等于改密钥。
                apiKey: "  synthetic-key  ",
            },
        });
    });

    it("把创建失败定位到具体字段，不只报一句总错", () => {
        const result = toCreateProviderCommand({ ...filled, name: "   ", baseUrl: "http://provider.example/v1" });

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.errors.name).toBe("name");
        expect(result.errors.baseUrl).toBe("address");
    });

    it("改名时留空的 key 表示保留原值，命令里不出现凭证字段", () => {
        const result = toUpdateProviderCommand(3, stored, { ...stored, name: "新名字", apiKey: "   " });

        expect(result).toEqual({ ok: true, command: { expectedVersion: 3, name: "新名字" } });
    });

    it("只换 key 时不改动其它未动字段", () => {
        const result = toUpdateProviderCommand(3, stored, { ...stored, apiKey: " rotated " });

        expect(result).toEqual({ ok: true, command: { expectedVersion: 3, apiKey: " rotated " } });
    });

    it("编辑没有任何改动时拒绝提交，避免空写与版本消耗", () => {
        const result = toUpdateProviderCommand(3, stored, { ...stored, apiKey: "" });

        expect(result).toEqual({ ok: false, errors: { form: "unchanged" } });
    });

    it("把发现候选补成可保存的模型，并拒绝超出上限的预算", () => {
        const draft = { modelId: "gpt-x", name: "GPT X", contextWindow: "128000", maxOutputTokens: "4096" };
        expect(toCreateModelCommand(draft)).toEqual({
            ok: true,
            command: { modelId: "gpt-x", name: "GPT X", contextWindow: 128000, maxOutputTokens: 4096 },
        });

        const tooLarge = toCreateModelCommand({ ...draft, maxOutputTokens: "256000" });
        expect(tooLarge.ok).toBe(false);
    });

    it("标记已配置的候选，而不是把它们从列表里藏掉", () => {
        const options = candidateOptions(
            [{ modelId: "gpt-x", name: "GPT X" }, { modelId: "gpt-y", name: "GPT Y" }],
            ["gpt-y"],
        );

        expect(options).toEqual([
            { modelId: "gpt-x", name: "GPT X", configured: false },
            { modelId: "gpt-y", name: "GPT Y", configured: true },
        ]);
    });

    it("把发现结果落成一句可行动的话，成功但空列表也要说清", () => {
        expect(discoveryNotice({ status: "succeeded", count: 3 })).toEqual({ kind: "found", count: 3 });
        expect(discoveryNotice({ status: "succeeded", count: 0 })).toEqual({ kind: "empty" });
        expect(discoveryNotice({ status: "failed", errorCode: "authentication_failed" }))
            .toEqual({ kind: "failed", reason: "authentication" });
        expect(discoveryNotice({ status: "failed", errorCode: "timeout" })).toEqual({ kind: "failed", reason: "timeout" });
        expect(discoveryNotice({ status: "failed", errorCode: "empty_result" })).toEqual({ kind: "empty" });
        expect(discoveryNotice({ status: "failed", errorCode: "response_too_large" }))
            .toEqual({ kind: "failed", reason: "tooLarge" });
        expect(discoveryNotice({ status: "failed", errorCode: "unsupported" }))
            .toEqual({ kind: "failed", reason: "unsupported" });
        expect(discoveryNotice({ status: "failed", errorCode: "malformed_response" }))
            .toEqual({ kind: "failed", reason: "malformed" });
        expect(discoveryNotice({ status: "failed", errorCode: "dependency_unavailable" }))
            .toEqual({ kind: "failed", reason: "unreachable" });
    });
});

describe("写操作失败的恢复提示", () => {
    it("版本冲突与凭证缺失分开，因为一个要重读、一个要补 key", () => {
        expect(writeFailureNotice(409, { code: "version_conflict" })).toBe("versionConflict");
        expect(writeFailureNotice(409, { code: "credential_missing" })).toBe("credentialMissing");
        expect(writeFailureNotice(403, { code: "forbidden_origin" })).toBe("unavailable");
    });

    it("凭证还没写成功时不能显示成「保存成功」", () => {
        expect(writeFailureNotice(503, { code: "credential_write_failed" })).toBe("credentialWriteFailed");
        expect(writeFailureNotice(503, { code: "cleanup_pending" })).toBe("cleanupPending");
        expect(writeFailureNotice(409, { code: "operation_in_progress" })).toBe("operationInProgress");
    });

    it("未知形状或异常正文不泄漏成界面文案，退回统一的不可用提示", () => {
        expect(writeFailureNotice(400, { code: "invalid_input" })).toBe("unavailable");
        expect(writeFailureNotice(500, "secret-key-abc")).toBe("unavailable");
        expect(writeFailureNotice(404, null)).toBe("notFound");
    });
});
describe("服务商写入结果", () => {
    const provider = {
        id: "provider-1",
        name: "测试服务商",
        api: "openai-completions" as const,
        baseUrl: "https://provider.example/v1",
        version: 1,
        state: "active" as const,
        credentialState: "configured" as const,
        createdAt: "2026-10-20T00:00:00.000Z",
        updatedAt: "2026-10-20T00:00:00.000Z",
    };

    it("直接返回服务商快照时才算保存成功", () => {
        expect(providerWriteOutcome(provider)).toEqual({ kind: "saved", provider });
    });

    it("操作还在 pending 时不能当作成功：此时 key 可能还没落盘", () => {
        const operation = {
            id: "operation-1",
            kind: "create" as const,
            providerId: "provider-1",
            state: "pending" as const,
            resourceVersion: null,
        };
        expect(providerWriteOutcome(operation)).toEqual({ kind: "pending", operation });
    });

    it("失败的操作带原因，凭证写失败与版本冲突的恢复动作不同", () => {
        expect(providerWriteOutcome({
            id: "operation-2",
            kind: "update" as const,
            providerId: "provider-1",
            state: "failed" as const,
            resourceVersion: null,
            errorCode: "credential_write_failed" as const,
        })).toEqual({ kind: "failed", notice: "credentialWriteFailed" });
        expect(providerWriteOutcome({
            id: "operation-3",
            kind: "update" as const,
            providerId: "provider-1",
            state: "failed" as const,
            resourceVersion: null,
            errorCode: "version_conflict" as const,
        })).toEqual({ kind: "failed", notice: "versionConflict" });
    });
});