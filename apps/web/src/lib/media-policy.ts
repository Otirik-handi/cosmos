import type { SourceMediaPolicy } from "@cosmos/contracts";

/**
 * 全局默认与上界（ADR-0014 决策 2）。界面只允许把来源策略调得更小，
 * 与公共 schema 的上界保持一致，避免两处数字漂移。
 */
export const MEDIA_POLICY_DEFAULTS = {
    maxFileBytes: 10 * 1024 * 1024,
    maxRunBytes: 50 * 1024 * 1024,
    /** 重试次数含首次尝试（ADR-0015 决策 3）。 */
    retryMaxAttempts: 3,
} as const;

const MEGABYTE = 1024 * 1024;
const MIN_FILE_BYTES = 64 * 1024;
const MIN_RUN_BYTES = MEGABYTE;
const MAX_RETRY_ATTEMPTS = 10;
const MAX_RETENTION_DAYS = 3650;

export type MediaPolicyImages = "download" | "metadata_only";

export type MediaPolicyFormValues = {
    images: MediaPolicyImages;
    /** MB 文本；空串表示跟随默认。 */
    maxFileMb: string;
    maxRunMb: string;
    /** 重试次数（含首次）；空串表示跟随默认。 */
    retryMaxAttempts: string;
    /** 保留天数；空串表示永久保留。 */
    retentionDays: string;
};

export type MediaPolicyParseResult =
    | { ok: true; policy: SourceMediaPolicy }
    | { ok: false; message: string };

export function mediaPolicyFormValues(
    policy: SourceMediaPolicy | undefined,
): MediaPolicyFormValues {
    return {
        images: policy?.images ?? "download",
        maxFileMb: policy?.maxFileBytes === undefined ? "" : formatMb(policy.maxFileBytes),
        maxRunMb: policy?.maxRunBytes === undefined ? "" : formatMb(policy.maxRunBytes),
        retryMaxAttempts: policy?.retry?.maxAttempts === undefined
            ? ""
            : String(policy.retry.maxAttempts),
        retentionDays: policy?.retentionDays === undefined
            ? ""
            : String(policy.retentionDays),
    };
}

/**
 * 表单 → 公共配置。空输入表示跟随默认；超出「只能收紧」范围时不发请求，
 * 直接把原因回给用户。
 */
export function parseMediaPolicyForm(values: MediaPolicyFormValues): MediaPolicyParseResult {
    const policy: SourceMediaPolicy = { images: values.images };

    const fileMb = parseMb(values.maxFileMb);
    if (fileMb === "invalid") {
        return { ok: false, message: "单文件上限请填写正数（单位 MB）。" };
    }
    if (fileMb !== null) {
        const bytes = Math.round(fileMb * MEGABYTE);
        if (bytes < MIN_FILE_BYTES || bytes > MEDIA_POLICY_DEFAULTS.maxFileBytes) {
            return {
                ok: false,
                message: `单文件上限需在 ${formatMb(MIN_FILE_BYTES)} 到 ${formatMb(MEDIA_POLICY_DEFAULTS.maxFileBytes)} 之间（只能比默认更小）。`,
            };
        }
        policy.maxFileBytes = bytes;
    }

    const runMb = parseMb(values.maxRunMb);
    if (runMb === "invalid") {
        return { ok: false, message: "单次上限请填写正数（单位 MB）。" };
    }
    if (runMb !== null) {
        const bytes = Math.round(runMb * MEGABYTE);
        if (bytes < MIN_RUN_BYTES || bytes > MEDIA_POLICY_DEFAULTS.maxRunBytes) {
            return {
                ok: false,
                message: `单次上限需在 ${formatMb(MIN_RUN_BYTES)} 到 ${formatMb(MEDIA_POLICY_DEFAULTS.maxRunBytes)} 之间（只能比默认更小）。`,
            };
        }
        policy.maxRunBytes = bytes;
    }

    const retryAttempts = parseCount(values.retryMaxAttempts);
    if (retryAttempts === "invalid") {
        return { ok: false, message: "重试次数请填写 0 到 10 的整数（含首次尝试）。" };
    }
    if (retryAttempts !== null) {
        if (retryAttempts > MAX_RETRY_ATTEMPTS) {
            return { ok: false, message: `重试次数最多 ${MAX_RETRY_ATTEMPTS} 次（含首次尝试）。` };
        }
        policy.retry = { maxAttempts: retryAttempts };
    }

    const retentionDays = parseCount(values.retentionDays);
    if (retentionDays === "invalid") {
        return { ok: false, message: "保留天数请填写 0 到 3650 的整数。" };
    }
    if (retentionDays !== null) {
        if (retentionDays > MAX_RETENTION_DAYS) {
            return { ok: false, message: `保留天数最多 ${MAX_RETENTION_DAYS} 天。` };
        }
        policy.retentionDays = retentionDays;
    }

    return { ok: true, policy };
}

/** 来源行的一句话摘要：区分「跟随默认」与「本来源已收紧」。 */
export function describeMediaPolicy(policy: SourceMediaPolicy | undefined): string {
    const parts: string[] = [];
    if (policy?.images === "metadata_only") {
        parts.push("仅记录元数据");
    }
    if (policy?.maxFileBytes !== undefined) {
        parts.push(`单文件 ≤ ${formatMb(policy.maxFileBytes)}`);
    }
    if (policy?.maxRunBytes !== undefined) {
        parts.push(`单次 ≤ ${formatMb(policy.maxRunBytes)}`);
    }
    if (policy?.retry?.maxAttempts !== undefined) {
        parts.push(policy.retry.maxAttempts === 0
            ? "不重试失败媒体"
            : `重试 ${policy.retry.maxAttempts} 次`);
    }
    if (policy?.retentionDays !== undefined) {
        parts.push(policy.retentionDays === 0
            ? "永久保留媒体"
            : `媒体保留 ${policy.retentionDays} 天`);
    }
    if (parts.length === 0) {
        return `跟随默认（${formatMb(MEDIA_POLICY_DEFAULTS.maxFileBytes)} / ${formatMb(MEDIA_POLICY_DEFAULTS.maxRunBytes)}，重试 ${MEDIA_POLICY_DEFAULTS.retryMaxAttempts} 次，永久保留）`;
    }
    return parts.join("；");
}

function parseCount(value: string): number | null | "invalid" {
    const trimmed = value.trim();
    if (trimmed === "") {
        return null;
    }
    if (!/^\d+$/.test(trimmed)) {
        return "invalid";
    }
    return Number.parseInt(trimmed, 10);
}

function parseMb(value: string): number | null | "invalid" {
    const trimmed = value.trim();
    if (trimmed === "") {
        return null;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return "invalid";
    }
    return parsed;
}

function formatMb(bytes: number): string {
    const mb = bytes / MEGABYTE;
    if (Number.isInteger(mb)) {
        return String(mb);
    }
    return mb.toFixed(mb < 1 ? 2 : 1);
}
