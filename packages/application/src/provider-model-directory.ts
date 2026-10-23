import type { ProviderModelDiscoveryErrorCode } from "@cosmos/contracts";

export interface ProviderModelDirectoryRequest {
    /** 已由 Provider 配置拼好的 `/models` 地址；transport 负责最终校验与地址绑定。 */
    url: string;
    bearerToken: string;
}

export interface ProviderModelDirectoryResponse {
    status: number;
    /** 已解析的 JSON 体；transport 保证不超过响应预算。 */
    body: unknown;
}

/**
 * 发现外呼的唯一出口。实现必须自己保证 HTTPS、地址审核、超时与响应预算，
 * 调用方只提供已保存的 URL 和本次凭据。
 */
export interface ProviderModelDirectoryPort {
    requestModels(input: ProviderModelDirectoryRequest): Promise<ProviderModelDirectoryResponse>;
}

/**
 * transport 在发出字节前后能识别的失败。用固定代码而不是任意错误串，
 * 保证失败快照只暴露安全的分类，不泄漏上游响应或凭据。
 */
export class ProviderModelDirectoryError extends Error {
    constructor(readonly code: Extract<
        ProviderModelDiscoveryErrorCode,
        "timeout" | "response_too_large" | "dependency_unavailable"
    >) {
        super(code);
        this.name = "ProviderModelDirectoryError";
    }
}
