import { Play, Power, PowerOff, SlidersHorizontal, Trash2, Webhook } from "lucide-react";
import { useMemo, useState } from "react";

import type {
    CollectionPlanSnapshot,
    CollectionPlanWebhookEntry,
    ConnectionInstance,
    MediaCleanupReport,
    SourceMediaPolicy,
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

type CollectionPlanListProps = {
    onRun: (plan: CollectionPlanSnapshot) => Promise<void>;
    onToggleActivation: (plan: CollectionPlanSnapshot, enabled: boolean) => Promise<void>;
    /** 删除计划（AUT-001，v1 仍是目标域命令）：墓碑语义，已录入历史保留；入口自己做两段确认。 */
    onDelete?: (plan: CollectionPlanSnapshot) => Promise<void>;
    /** 保存计划级媒体策略（ADR-0014）：只影响之后入队的采集。 */
    onSaveMediaPolicy: (plan: CollectionPlanSnapshot, policy: SourceMediaPolicy) => Promise<void>;
    /**
     * Webhook 入口（ADR-0024）：生成/轮换返回唯一一次明文凭证，撤销删掉入口与凭证字节。
     * 两者都省略时该行的入口面板不出现（组件实验室等只读场景）。
     */
    onRotateWebhookEntry?: (plan: CollectionPlanSnapshot) => Promise<CollectionPlanWebhookEntry>;
    onRevokeWebhookEntry?: (plan: CollectionPlanSnapshot) => Promise<void>;
    /** 保留期清理：预览（dryRun）与确认执行（ADR-0015 决策 7）。 */
    onPreviewMediaCleanup?: () => Promise<MediaCleanupReport>;
    onConfirmMediaCleanup?: () => Promise<MediaCleanupReport>;
    activatingPlanId?: string | null;
    deletingPlanId?: string | null;
    runningPlanId?: string | null;
    plans: readonly CollectionPlanSnapshot[];
    /** 用于把计划的 `connectionId` 显示成连接名（ADR-0017）。 */
    connections: readonly ConnectionInstance[];
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
 * 定时语义一行话：看板读者据此知道该计划何时被 Worker 自动抓取。
 * 表单入口只允许整数分钟，秒/小时/天分支覆盖 API 直接创建的非整分钟配置。
 */
function scheduleLine(plan: CollectionPlanSnapshot): string {
    const interval = plan.scheduleIntervalMs ?? null;
    if (!plan.enabled) {
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

const UNBOUND_GROUP_KEY = "__unbound__";

/**
 * 按连接分组（AUT-010）：同一个连接下的多个计划要能一眼看全，各自带自己的频率与
 * 最近一次失败。没有连接的计划归到「未绑定连接」组——它们仍然可采集，只是不需要凭证。
 */
function groupPlans(
    plans: readonly CollectionPlanSnapshot[],
    connections: readonly ConnectionInstance[],
): readonly { key: string; label: string; plans: readonly CollectionPlanSnapshot[] }[] {
    const nameOf = new Map(connections.map((connection) => [connection.id, connection.name]));
    const groups = new Map<string, CollectionPlanSnapshot[]>();
    for (const plan of plans) {
        const key = plan.connectionId ?? UNBOUND_GROUP_KEY;
        const bucket = groups.get(key);
        if (bucket) {
            bucket.push(plan);
        } else {
            groups.set(key, [plan]);
        }
    }
    // 有连接的组按名称排在前面，未绑定组固定压尾：产品面关心的是「哪个账号下有哪几路采集」。
    return [...groups.entries()]
        .map(([key, grouped]) => ({
            key,
            label: key === UNBOUND_GROUP_KEY
                ? "未绑定连接"
                : nameOf.get(key) ?? `连接 ${key}`,
            plans: grouped,
        }))
        .sort((left, right) => {
            if (left.key === UNBOUND_GROUP_KEY) return 1;
            if (right.key === UNBOUND_GROUP_KEY) return -1;
            return left.label.localeCompare(right.label, "zh-Hans-CN");
        });
}

/** 采集计划看板：按连接分组，每行解释启用状态、定时计划、媒体预算、最近运行与错误。 */
export function CollectionPlanList({
    onRun,
    onToggleActivation,
    onDelete,
    onSaveMediaPolicy,
    onRotateWebhookEntry,
    onRevokeWebhookEntry,
    onPreviewMediaCleanup,
    onConfirmMediaCleanup,
    activatingPlanId = null,
    deletingPlanId = null,
    runningPlanId = null,
    plans,
    connections,
}: CollectionPlanListProps) {
    const [editingPolicyId, setEditingPolicyId] = useState<string | null>(null);
    // 删除是两段确认：第一次点击把该行切到确认态，第二次才发命令。
    const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
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
    // 入口面板同一时刻只开一个；明文凭证只保留在打开它的这一次交互里。
    const [webhookPlanId, setWebhookPlanId] = useState<string | null>(null);
    const [webhookEntry, setWebhookEntry] = useState<CollectionPlanWebhookEntry | null>(null);
    const [webhookBusy, setWebhookBusy] = useState(false);
    const [webhookError, setWebhookError] = useState<string | null>(null);
    const groups = useMemo(() => groupPlans(plans, connections), [plans, connections]);

    const toggleWebhookPanel = (plan: CollectionPlanSnapshot): void => {
        setWebhookEntry(null);
        setWebhookError(null);
        setWebhookPlanId((current) => (current === plan.id ? null : plan.id));
    };

    const rotateWebhookEntry = async (plan: CollectionPlanSnapshot): Promise<void> => {
        if (!onRotateWebhookEntry) return;
        setWebhookBusy(true);
        setWebhookError(null);
        try {
            setWebhookEntry(await onRotateWebhookEntry(plan));
        } catch (error) {
            setWebhookError(error instanceof Error ? error.message : "生成 Webhook 入口失败。");
        } finally {
            setWebhookBusy(false);
        }
    };

    const revokeWebhookEntry = async (plan: CollectionPlanSnapshot): Promise<void> => {
        if (!onRevokeWebhookEntry) return;
        setWebhookBusy(true);
        setWebhookError(null);
        try {
            await onRevokeWebhookEntry(plan);
            setWebhookEntry(null);
        } catch (error) {
            setWebhookError(error instanceof Error ? error.message : "撤销 Webhook 入口失败。");
        } finally {
            setWebhookBusy(false);
        }
    };

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

    const startEditingPolicy = (plan: CollectionPlanSnapshot): void => {
        setEditingPolicyId(plan.id);
        setPolicyForm(mediaPolicyFormValues(plan.mediaPolicy));
        setPolicyError(null);
    };

    const submitPolicy = async (plan: CollectionPlanSnapshot): Promise<void> => {
        const parsed = parseMediaPolicyForm(policyForm);
        if (!parsed.ok) {
            setPolicyError(parsed.message);
            return;
        }
        setPolicyError(null);
        try {
            await onSaveMediaPolicy(plan, parsed.policy);
            setEditingPolicyId(null);
        } catch (error) {
            setPolicyError(error instanceof Error ? error.message : "保存媒体策略失败。");
        }
    };

    return (
        <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
                <h2 className="font-display text-lg font-semibold tracking-tight">采集计划</h2>
                <p className="text-sm text-muted-foreground">
                    {plans.length === 0
                        ? "创建第一个采集计划。"
                        : "启用后按各自频率自动抓取；同一个连接下可以有多个计划，互不影响。"}
                </p>
            </div>
            {plans.length === 0 ? (
                <p className="rounded-[var(--radius-control)] border border-dashed px-3 py-4 text-sm leading-6 text-muted-foreground">
                    还没有采集计划；点击右上角“新建计划”开始。
                </p>
            ) : (
                <div className="flex flex-col gap-4">
                    {groups.map((group) => (
                        <div key={group.key} className="flex flex-col gap-1" data-plan-group={group.key}>
                            <h3 className="text-xs font-medium text-muted-foreground">
                                {group.label}
                                <span className="ml-1 font-normal">（{group.plans.length} 个计划）</span>
                            </h3>
                            <ul className="flex flex-col">
                                {group.plans.map((plan) => {
                                    const running = runningPlanId === plan.id;
                                    const activating = activatingPlanId === plan.id;
                                    const deleting = deletingPlanId === plan.id;
                                    const confirmingDelete = confirmingDeleteId === plan.id;
                                    const editingPolicy = editingPolicyId === plan.id;
                                    const webhookOpen = webhookPlanId === plan.id;
                                    return (
                                        <li
                                            key={plan.id}
                                            className="flex flex-col gap-2 border-b py-3 first:pt-0 last:border-b-0 last:pb-0"
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex min-w-0 flex-col gap-0.5">
                                                    <div className="flex min-w-0 items-center gap-2">
                                                        <Badge
                                                            variant={plan.enabled ? "secondary" : "outline"}
                                                            className="shrink-0"
                                                        >
                                                            {plan.enabled ? "已启用" : "已停用"}
                                                        </Badge>
                                                        <span className="truncate text-sm font-medium">{plan.name}</span>
                                                    </div>
                                                    <span className="text-xs">{scheduleLine(plan)}</span>
                                                    {onRotateWebhookEntry && (
                                                        <span className="text-xs text-muted-foreground">
                                                            Webhook 入口：{plan.webhook ? "已配置" : "未生成"}
                                                        </span>
                                                    )}
                                                    <span className="text-xs text-muted-foreground">
                                                        媒体策略：{describeMediaPolicy(plan.mediaPolicy)}
                                                    </span>
                                                    <span className="text-xs text-muted-foreground">
                                                        {formatLastRun(plan.lastRunAt)}
                                                    </span>
                                                    {plan.lastError && (
                                                        <span
                                                            title={plan.lastError}
                                                            className="truncate text-xs text-destructive"
                                                        >
                                                            {plan.lastError}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex shrink-0 items-center gap-1">
                                                    <Button
                                                        size="icon-sm"
                                                        variant="outline"
                                                        disabled={activating || running}
                                                        onClick={() => void onToggleActivation(plan, !plan.enabled)}
                                                    >
                                                        {plan.enabled ? <PowerOff aria-hidden={true} /> : <Power aria-hidden={true} />}
                                                        <span className="sr-only">
                                                            {plan.enabled ? `停用 ${plan.name}` : `启用 ${plan.name}`}
                                                        </span>
                                                    </Button>
                                                    <Button
                                                        size="icon-sm"
                                                        variant="outline"
                                                        disabled={!plan.enabled || running || activating}
                                                        onClick={() => void onRun(plan)}
                                                    >
                                                        <Play aria-hidden={true} />
                                                        <span className="sr-only">{plan.name}</span>
                                                    </Button>
                                                    {onRotateWebhookEntry && (
                                                        <Button
                                                            size="icon-sm"
                                                            variant="outline"
                                                            aria-expanded={webhookOpen}
                                                            disabled={webhookBusy && webhookOpen}
                                                            onClick={() => toggleWebhookPanel(plan)}
                                                        >
                                                            <Webhook aria-hidden={true} />
                                                            <span className="sr-only">Webhook 入口 {plan.name}</span>
                                                        </Button>
                                                    )}
                                                    <Button
                                                        size="icon-sm"
                                                        variant="outline"
                                                        aria-expanded={editingPolicy}
                                                        onClick={() => {
                                                            if (editingPolicy) {
                                                                setEditingPolicyId(null);
                                                                return;
                                                            }
                                                            startEditingPolicy(plan);
                                                        }}
                                                    >
                                                        <SlidersHorizontal aria-hidden={true} />
                                                        <span className="sr-only">媒体策略 {plan.name}</span>
                                                    </Button>
                                                    {onDelete && (
                                                        <Button
                                                            size="icon-sm"
                                                            variant={confirmingDelete ? "destructive" : "outline"}
                                                            disabled={deleting || running || activating}
                                                            aria-label={confirmingDelete
                                                                ? `确认删除 ${plan.name}`
                                                                : `删除 ${plan.name}`}
                                                            onClick={() => {
                                                                if (!confirmingDelete) {
                                                                    setConfirmingDeleteId(plan.id);
                                                                    return;
                                                                }
                                                                setConfirmingDeleteId(null);
                                                                void onDelete(plan);
                                                            }}
                                                        >
                                                            <Trash2 aria-hidden={true} />
                                                            <span className="sr-only">
                                                                {confirmingDelete ? `确认删除 ${plan.name}` : `删除 ${plan.name}`}
                                                            </span>
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>
                                            {confirmingDelete && (
                                                <p
                                                    role="status"
                                                    className="rounded-[var(--radius-control)] border border-dashed px-3 py-2 text-xs leading-5 text-muted-foreground"
                                                >
                                                    删除计划只移除采集配置与定时：已录入的条目、来源历史与媒体都保留。
                                                    再次点击该按钮确认删除，或点其它地方取消。
                                                </p>
                                            )}
                                            {webhookOpen && onRotateWebhookEntry && (
                                                <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border bg-muted/30 p-3">
                                                    <p className="text-xs leading-5 text-muted-foreground">
                                                        入口给外部自动化调用：带上凭证与事件标识请求它，Cosmos 立刻为这个计划排一次采集。
                                                        凭证只在生成时显示一次；轮换会立即作废旧凭证。计划停用时入口会拒绝请求。
                                                    </p>
                                                    {plan.webhook ? (
                                                        <div className="flex flex-col gap-0.5">
                                                            <span className="text-xs text-muted-foreground">入口地址</span>
                                                            <code className="break-all rounded-sm border bg-card px-2 py-1 text-xs">
                                                                {entryAddress(plan.webhook.entryPath)}
                                                            </code>
                                                            <span className="text-xs text-muted-foreground">
                                                                凭证：{plan.webhook.credentialConfigured ? "已配置" : "缺失，请轮换"}
                                                            </span>
                                                        </div>
                                                    ) : (
                                                        <span className="text-xs text-muted-foreground">
                                                            这个计划还没有入口。生成后把它填进你的脚本或定时任务。
                                                        </span>
                                                    )}
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            disabled={webhookBusy}
                                                            onClick={() => void rotateWebhookEntry(plan)}
                                                        >
                                                            {plan.webhook ? "轮换入口" : "生成入口"}
                                                        </Button>
                                                        {plan.webhook && onRevokeWebhookEntry && (
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                disabled={webhookBusy}
                                                                onClick={() => void revokeWebhookEntry(plan)}
                                                            >
                                                                撤销入口
                                                            </Button>
                                                        )}
                                                    </div>
                                                    {webhookEntry?.planId === plan.id && (
                                                        <div
                                                            role="status"
                                                            className="flex flex-col gap-1 rounded-[var(--radius-control)] border border-dashed bg-card p-2"
                                                        >
                                                            <span className="text-xs font-medium">
                                                                凭证只显示这一次，请立即保存
                                                            </span>
                                                            <code className="break-all text-xs">{webhookEntry.credential}</code>
                                                            <span className="text-xs text-muted-foreground">调用示例</span>
                                                            <code className="break-all text-xs">
                                                                {webhookCallExample(webhookEntry.entryPath, webhookEntry.credential)}
                                                            </code>
                                                        </div>
                                                    )}
                                                    {webhookError && (
                                                        <span className="text-xs text-destructive">{webhookError}</span>
                                                    )}
                                                </div>
                                            )}
                                            {editingPolicy && (
                                                <form
                                                    aria-label={`媒体策略 ${plan.name}`}
                                                    className="flex flex-col gap-2 rounded-[var(--radius-control)] border bg-muted/30 p-3"
                                                    onSubmit={(event) => {
                                                        event.preventDefault();
                                                        void submitPolicy(plan);
                                                    }}
                                                >
                                                    <p className="text-xs text-muted-foreground">
                                                        只影响之后的采集；已保存的媒体不会被改写或删除。上限只能比全局默认更小。
                                                    </p>
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <label
                                                            htmlFor={`media-policy-images-${plan.id}`}
                                                            className="text-sm"
                                                        >
                                                            图片
                                                        </label>
                                                        <select
                                                            id={`media-policy-images-${plan.id}`}
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
                                                            htmlFor={`media-policy-max-file-${plan.id}`}
                                                            className="text-sm"
                                                        >
                                                            单文件上限（MB）
                                                        </label>
                                                        <Input
                                                            id={`media-policy-max-file-${plan.id}`}
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
                                                            htmlFor={`media-policy-max-run-${plan.id}`}
                                                            className="text-sm"
                                                        >
                                                            单次上限（MB）
                                                        </label>
                                                        <Input
                                                            id={`media-policy-max-run-${plan.id}`}
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
                                                            htmlFor={`media-policy-retry-${plan.id}`}
                                                            className="text-sm"
                                                        >
                                                            失败重试次数
                                                        </label>
                                                        <Input
                                                            id={`media-policy-retry-${plan.id}`}
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
                                                            htmlFor={`media-policy-retention-${plan.id}`}
                                                            className="text-sm"
                                                        >
                                                            保留天数
                                                        </label>
                                                        <Input
                                                            id={`media-policy-retention-${plan.id}`}
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
                        </div>
                    ))}
                </div>
            )}
            {(onPreviewMediaCleanup || onConfirmMediaCleanup) && (
                <div
                    className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-dashed p-3"
                    data-media-cleanup="true"
                >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="max-w-xl text-xs text-muted-foreground">
                            按计划保留期清理过期媒体：先预览，确认后才会删除字节；条目、元数据与原文外链保留。
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

/**
 * 入口由 Cosmos API 提供；产品面把 `/hooks/*` 透传给 API，所以「当前访问地址 + 入口路径」
 * 就是用户可以直接复制使用的入口地址。
 */
function entryAddress(entryPath: string): string {
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    return `${origin}${entryPath}`;
}

function webhookCallExample(entryPath: string, credential: string): string {
    return `curl -X POST ${entryAddress(entryPath)} -H "x-cosmos-credential: ${credential}" -H "x-cosmos-event-id: <事件 id>"`;
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
