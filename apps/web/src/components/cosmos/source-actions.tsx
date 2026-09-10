import { Play, Power, PowerOff, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

import type {
    MediaCleanupReport,
    SourceMediaPolicy,
    SourceSnapshot,
} from "@cosmos/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    describeMediaPolicy,
    mediaPolicyFormValues,
    parseMediaPolicyForm,
    type MediaPolicyFormValues,
} from "@/lib/media-policy";

type SourceActionsProps = {
    onRun: (source: SourceSnapshot) => Promise<void>;
    onToggleActivation: (source: SourceSnapshot, enabled: boolean) => Promise<void>;
    /** 保存来源级媒体策略（ADR-0014）：只影响之后入队的采集。 */
    onSaveMediaPolicy: (source: SourceSnapshot, policy: SourceMediaPolicy) => Promise<void>;
    /** 保留期清理：预览（dryRun）与确认执行（ADR-0015 决策 7）。 */
    onPreviewMediaCleanup?: () => Promise<MediaCleanupReport>;
    onConfirmMediaCleanup?: () => Promise<MediaCleanupReport>;
    activatingSourceId?: string | null;
    runningSourceId?: string | null;
    sources: readonly SourceSnapshot[];
};

/** 稳定的中文运行时间；解析失败按“尚未运行”处理。 */
function formatLastRun(value: string | null): string {
    if (!value) {
        return "尚未运行";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "尚未运行";
    }
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `上次运行 ${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${hours}:${minutes}`;
}

/**
 * 定时语义一行话：看板读者据此知道该来源何时被 Worker 自动抓取。
 * 表单入口只允许整数分钟，秒/小时/天分支覆盖 API 直接创建的非整分钟配置。
 */
function scheduleLine(source: SourceSnapshot): string {
    const interval = source.scheduleIntervalMs ?? null;
    if (!source.enabled) {
        return interval ? "已停用，定时抓取暂停" : "已停用";
    }
    if (!interval) {
        return "未配置定时，仅手动录入";
    }
    return `每 ${formatInterval(interval)}自动抓取`;
}

function formatInterval(intervalMs: number): string {
    if (intervalMs % 86_400_000 === 0) {
        return `${intervalMs / 86_400_000} 天`;
    }
    if (intervalMs % 3_600_000 === 0) {
        return `${intervalMs / 3_600_000} 小时`;
    }
    if (intervalMs % 60_000 === 0) {
        return `${intervalMs / 60_000} 分钟`;
    }
    return `${Math.round(intervalMs / 1000)} 秒`;
}

/** 来源健康看板：每行解释启用状态、定时计划、最近运行与错误；启停、手动录入与媒体策略都在行内完成。 */
export function SourceActions({
    onRun,
    onToggleActivation,
    onSaveMediaPolicy,
    onPreviewMediaCleanup,
    onConfirmMediaCleanup,
    activatingSourceId = null,
    runningSourceId = null,
    sources,
}: SourceActionsProps) {
    const [editingPolicyId, setEditingPolicyId] = useState<string | null>(null);
    const [policyForm, setPolicyForm] = useState<MediaPolicyFormValues>({
        images: "download",
        maxFileMb: "",
        maxRunMb: "",
        retryMaxAttempts: "",
        retentionDays: "",
    });
    const [policyError, setPolicyError] = useState<string | null>(null);
    const [cleanupPreview, setCleanupPreview] = useState<MediaCleanupReport | null>(null);
    const [cleanupResult, setCleanupResult] = useState<MediaCleanupReport | null>(null);
    const [cleanupBusy, setCleanupBusy] = useState(false);
    const [cleanupError, setCleanupError] = useState<string | null>(null);

    const previewCleanup = async (): Promise<void> => {
        if (!onPreviewMediaCleanup) return;
        setCleanupBusy(true);
        setCleanupError(null);
        setCleanupResult(null);
        try {
            setCleanupPreview(await onPreviewMediaCleanup());
        } catch (error) {
            setCleanupError(error instanceof Error ? error.message : "预览过期媒体失败。");
        } finally {
            setCleanupBusy(false);
        }
    };

    const confirmCleanup = async (): Promise<void> => {
        if (!onConfirmMediaCleanup) return;
        setCleanupBusy(true);
        setCleanupError(null);
        try {
            setCleanupResult(await onConfirmMediaCleanup());
            setCleanupPreview(null);
        } catch (error) {
            setCleanupError(error instanceof Error ? error.message : "清理过期媒体失败。");
        } finally {
            setCleanupBusy(false);
        }
    };

    const startEditingPolicy = (source: SourceSnapshot): void => {
        setEditingPolicyId(source.id);
        setPolicyForm(mediaPolicyFormValues(source.config.media));
        setPolicyError(null);
    };

    const submitPolicy = async (source: SourceSnapshot): Promise<void> => {
        const parsed = parseMediaPolicyForm(policyForm);
        if (!parsed.ok) {
            setPolicyError(parsed.message);
            return;
        }
        setPolicyError(null);
        try {
            await onSaveMediaPolicy(source, parsed.policy);
            setEditingPolicyId(null);
        } catch (error) {
            setPolicyError(error instanceof Error ? error.message : "保存媒体策略失败。");
        }
    };

    return (
        <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
                <h2 className="font-display text-lg font-semibold tracking-tight">来源健康</h2>
                <p className="text-sm text-muted-foreground">
                    {sources.length === 0 ? "创建第一个 RSS 来源。" : "启用来源后按计划自动抓取；停用即暂停。"}
                </p>
            </div>
            {sources.length === 0 ? (
                <p className="rounded-[var(--radius-control)] border border-dashed px-3 py-4 text-sm leading-6 text-muted-foreground">
                    还没有可用来源；点击右上角“新建来源”开始。
                </p>
            ) : (
                <ul className="flex flex-col">
                    {sources.map((source) => {
                        const running = runningSourceId === source.id;
                        const activating = activatingSourceId === source.id;
                        const editingPolicy = editingPolicyId === source.id;
                        return (
                            <li
                                key={source.id}
                                className="flex flex-col gap-2 border-b py-3 first:pt-0 last:border-b-0 last:pb-0"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex min-w-0 flex-col gap-0.5">
                                        <div className="flex min-w-0 items-center gap-2">
                                            <Badge
                                                variant={source.enabled ? "secondary" : "outline"}
                                                className="shrink-0"
                                            >
                                                {source.enabled ? "已启用" : "已停用"}
                                            </Badge>
                                            <span className="truncate text-sm font-medium">{source.name}</span>
                                        </div>
                                        <span
                                            title={`${source.kind} · ${source.sourceDefinitionRef}`}
                                            className="min-w-0 truncate text-xs text-muted-foreground"
                                        >
                                            {source.kind} · {source.sourceDefinitionRef}
                                        </span>
                                        <span className="text-xs">{scheduleLine(source)}</span>
                                        <span className="text-xs text-muted-foreground">
                                            媒体策略：{describeMediaPolicy(source.config.media)}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                            {formatLastRun(source.lastRunAt)}
                                        </span>
                                        {source.lastError && (
                                            <span
                                                title={source.lastError}
                                                className="truncate text-xs text-destructive"
                                            >
                                                {source.lastError}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                        <Button
                                            size="icon-sm"
                                            variant="outline"
                                            disabled={activating || running}
                                            onClick={() => void onToggleActivation(source, !source.enabled)}
                                        >
                                            {source.enabled ? <PowerOff aria-hidden={true} /> : <Power aria-hidden={true} />}
                                            <span className="sr-only">
                                                {source.enabled ? `停用 ${source.name}` : `启用 ${source.name}`}
                                            </span>
                                        </Button>
                                        <Button
                                            size="icon-sm"
                                            variant="outline"
                                            disabled={!source.enabled || running || activating}
                                            onClick={() => void onRun(source)}
                                        >
                                            <Play aria-hidden={true} />
                                            <span className="sr-only">{source.name}</span>
                                        </Button>
                                        <Button
                                            size="icon-sm"
                                            variant="outline"
                                            aria-expanded={editingPolicy}
                                            onClick={() => {
                                                if (editingPolicy) {
                                                    setEditingPolicyId(null);
                                                    return;
                                                }
                                                startEditingPolicy(source);
                                            }}
                                        >
                                            <SlidersHorizontal aria-hidden={true} />
                                            <span className="sr-only">媒体策略 {source.name}</span>
                                        </Button>
                                    </div>
                                </div>
                                {editingPolicy && (
                                    <form
                                        aria-label={`媒体策略 ${source.name}`}
                                        className="flex flex-col gap-2 rounded-[var(--radius-control)] border bg-muted/30 p-3"
                                        onSubmit={(event) => {
                                            event.preventDefault();
                                            void submitPolicy(source);
                                        }}
                                    >
                                        <p className="text-xs text-muted-foreground">
                                            只影响之后的采集；已保存的媒体不会被改写或删除。上限只能比全局默认更小。
                                        </p>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <label
                                                htmlFor={`media-policy-images-${source.id}`}
                                                className="text-sm"
                                            >
                                                图片
                                            </label>
                                            <select
                                                id={`media-policy-images-${source.id}`}
                                                value={policyForm.images}
                                                className="rounded-sm border bg-card px-2 py-1 text-sm"
                                                onChange={(event) => {
                                                    setPolicyForm((current) => ({
                                                        ...current,
                                                        images: event.target.value as MediaPolicyFormValues["images"],
                                                    }));
                                                }}
                                            >
                                                <option value="download">下载并保存</option>
                                                <option value="metadata_only">仅记录元数据</option>
                                            </select>
                                            <label
                                                htmlFor={`media-policy-max-file-${source.id}`}
                                                className="text-sm"
                                            >
                                                单文件上限（MB）
                                            </label>
                                            <Input
                                                id={`media-policy-max-file-${source.id}`}
                                                value={policyForm.maxFileMb}
                                                placeholder="10"
                                                className="w-24"
                                                onChange={(event) => {
                                                    setPolicyForm((current) => ({
                                                        ...current,
                                                        maxFileMb: event.target.value,
                                                    }));
                                                }}
                                            />
                                            <label
                                                htmlFor={`media-policy-max-run-${source.id}`}
                                                className="text-sm"
                                            >
                                                单次上限（MB）
                                            </label>
                                            <Input
                                                id={`media-policy-max-run-${source.id}`}
                                                value={policyForm.maxRunMb}
                                                placeholder="50"
                                                className="w-24"
                                                onChange={(event) => {
                                                    setPolicyForm((current) => ({
                                                        ...current,
                                                        maxRunMb: event.target.value,
                                                    }));
                                                }}
                                            />
                                            <label
                                                htmlFor={`media-policy-retry-${source.id}`}
                                                className="text-sm"
                                            >
                                                失败重试次数
                                            </label>
                                            <Input
                                                id={`media-policy-retry-${source.id}`}
                                                value={policyForm.retryMaxAttempts}
                                                placeholder="3"
                                                className="w-20"
                                                onChange={(event) => {
                                                    setPolicyForm((current) => ({
                                                        ...current,
                                                        retryMaxAttempts: event.target.value,
                                                    }));
                                                }}
                                            />
                                            <label
                                                htmlFor={`media-policy-retention-${source.id}`}
                                                className="text-sm"
                                            >
                                                保留天数
                                            </label>
                                            <Input
                                                id={`media-policy-retention-${source.id}`}
                                                value={policyForm.retentionDays}
                                                placeholder="永久"
                                                className="w-20"
                                                onChange={(event) => {
                                                    setPolicyForm((current) => ({
                                                        ...current,
                                                        retentionDays: event.target.value,
                                                    }));
                                                }}
                                            />
                                        </div>
                                        {policyError && (
                                            <p
                                                role="alert"
                                                data-media-policy-error="true"
                                                className="text-xs text-destructive"
                                            >
                                                {policyError}
                                            </p>
                                        )}
                                        <div className="flex items-center gap-2">
                                            <Button type="submit" size="sm" variant="outline">
                                                保存媒体策略
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => setEditingPolicyId(null)}
                                            >
                                                取消
                                            </Button>
                                        </div>
                                    </form>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
            {(onPreviewMediaCleanup || onConfirmMediaCleanup) && (
                <div
                    className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-dashed p-3"
                    data-media-cleanup="true"
                >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="max-w-xl text-xs text-muted-foreground">
                            按来源保留期清理过期媒体：先预览，确认后才会删除字节；条目、元数据与原文外链保留。
                        </p>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={cleanupBusy || !onPreviewMediaCleanup}
                            onClick={() => void previewCleanup()}
                        >
                            预览过期媒体
                        </Button>
                    </div>
                    {cleanupPreview && (
                        <div
                            className="flex flex-col gap-1 text-xs"
                            data-media-cleanup-preview="true"
                        >
                            <span>
                                可清理 {cleanupPreview.candidateCount} 项，约
                                {" "}{formatBytes(cleanupPreview.candidateBytes)}
                                {cleanupPreview.sharedKeyCount > 0
                                    && `（其中 ${cleanupPreview.sharedKeyCount} 项字节与其它条目共用，只解除引用）`}
                            </span>
                            {cleanupPreview.samples.slice(0, 5).map((sample) => (
                                <span key={sample.assetId} className="truncate text-muted-foreground">
                                    {sample.title ?? sample.assetId}
                                    {" · "}
                                    {sample.sourceName ?? sample.sourceId ?? "未知来源"}
                                    {" · "}
                                    {formatBytes(sample.byteSize ?? 0)}
                                </span>
                            ))}
                            {cleanupPreview.candidateCount > 0 && onConfirmMediaCleanup && (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="w-fit"
                                    disabled={cleanupBusy}
                                    onClick={() => void confirmCleanup()}
                                >
                                    确认清理 {cleanupPreview.candidateCount} 项
                                </Button>
                            )}
                        </div>
                    )}
                    {cleanupResult && (
                        <p className="text-xs" data-media-cleanup-result="true">
                            已清理 {cleanupResult.cleanedCount} 项，释放 {formatBytes(cleanupResult.cleanedBytes)}；
                            条目与原文外链保留。
                        </p>
                    )}
                    {cleanupError && (
                        <p role="alert" className="text-xs text-destructive">{cleanupError}</p>
                    )}
                </div>
            )}
        </section>
    );
}

function formatBytes(value: number): string {
    if (value >= 1024 * 1024) {
        return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    }
    if (value >= 1024) {
        return `${Math.max(1, Math.round(value / 1024))} KB`;
    }
    return `${value} B`;
}
