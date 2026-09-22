"use client";

import { useEffect, useState, type ComponentProps } from "react";

import type { JobSnapshot, RunControlResult, RunSnapshot } from "@cosmos/contracts";
import type { HttpCosmosClient } from "@cosmos/transport-http";

import { Badge } from "@/components/ui/badge";
import { RunControl } from "@/components/cosmos/run-control";

const statusLabel: Record<RunSnapshot["status"], string> = {
    queued: "排队中",
    running: "运行中",
    succeeded: "成功",
    failed: "失败",
    cancelled: "已取消",
};

const jobStatusLabel: Record<JobSnapshot["status"], string> = {
    queued: "排队中",
    leased: "执行中",
    retry_wait: "等待重试",
    succeeded: "成功",
    failed_terminal: "失败",
    cancelled: "已取消",
};

const statusVariant = {
    queued: "secondary",
    running: "secondary",
    succeeded: "default",
    failed: "destructive",
    cancelled: "outline",
} as const satisfies Record<RunSnapshot["status"], NonNullable<ComponentProps<typeof Badge>["variant"]>>;

const triggerLabel: Record<RunSnapshot["triggerKind"], string> = {
    manual: "手动",
    schedule: "定时",
    // 面向用户说「谁触发的」：webhook 是外部系统调入口（ADR-0024），不暴露内部类型名。
    webhook: "外部触发",
};

function formatTime(value: string | null): string {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    const pad = (n: number): string => String(n).padStart(2, "0");
    return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type RunHistoryProps = {
    client: HttpCosmosClient;
    /** 页面在手动录入/来源操作后递增，驱动列表重取。 */
    refreshToken?: number;
};

/**
 * 运行记录（RUN-004）：列出最近 durable Run，点击展开详情——元数据 + RunControl
 * （取消/恢复/重新运行 + 复用/副作用说明）。每个控制动作后重取列表，让状态与
 * 新 Run（重跑）即时可见。
 */
export function RunHistory({ client, refreshToken = 0 }: RunHistoryProps) {
    const [runs, setRuns] = useState<readonly RunSnapshot[] | null>(null);
    const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [lastResult, setLastResult] = useState<RunControlResult | null>(null);
    const [controlError, setControlError] = useState<string | null>(null);
    // 选中 Run 的 Job（OPS-002）：状态、重试次数与错误。Run 投影里没有 job 引用，
    // 所以这里按选中项单独取一次；结果带上 runId，渲染时比对，避免切换选中后旧响应覆盖。
    const [jobs, setJobs] = useState<{ runId: string; items: readonly JobSnapshot[] } | null>(null);
    const [jobsError, setJobsError] = useState<string | null>(null);

    const load = (): void => {
        client.listRuns({ limit: 20 })
            .then((list) => {
                setRuns(list);
                setState("loaded");
            })
            .catch(() => setState("error"));
    };

    useEffect(() => {
        let cancelled = false;
        client.listRuns({ limit: 20 })
            .then((list) => {
                if (!cancelled) {
                    setRuns(list);
                    setState("loaded");
                }
            })
            .catch(() => {
                if (!cancelled) setState("error");
            });
        return () => {
            cancelled = true;
        };
    }, [client, refreshToken]);

    if (state === "loading") {
        return <p className="text-sm text-muted-foreground">正在读取运行记录…</p>;
    }
    if (state === "error") {
        return <p className="text-sm text-muted-foreground">运行记录读取失败。</p>;
    }
    if (!runs || runs.length === 0) {
        return (
            <p className="text-sm text-muted-foreground">
                还没有运行记录；启用来源并手动录入后会出现在这里。
            </p>
        );
    }

    const selected = runs.find((run) => run.id === selectedId) ?? null;

    const control = (action: () => Promise<RunControlResult>): void => {
        setBusy(true);
        setLastResult(null);
        setControlError(null);
        action()
            .then((result) => {
                setLastResult(result);
                load();
            })
            .catch((caught: unknown) => {
                setControlError(caught instanceof Error ? caught.message : "控制操作失败。");
            })
            .finally(() => setBusy(false));
    };

    return (
        <div className="flex flex-col gap-2">
            <ul className="grid gap-1">
                {runs.map((run) => (
                    <li key={run.id}>
                        <button
                            type="button"
                            data-run-id={run.id}
                            disabled={selectedId === run.id}
                            onClick={() => {
                                setSelectedId(run.id);
                                setLastResult(null);
                                setControlError(null);
                                setJobs(null);
                                setJobsError(null);
                                client.listRunJobs(run.id)
                                    .then((list) => setJobs({ runId: run.id, items: list }))
                                    .catch((caught: unknown) => {
                                        setJobsError(caught instanceof Error ? caught.message : "任务列表读取失败。");
                                    });
                            }}
                            className="flex w-full items-center justify-between gap-2 rounded-sm border bg-card px-3 py-2 text-left text-sm hover:bg-muted/40 focus-visible:border-ring focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none disabled:opacity-60"
                        >
                            <span className="flex min-w-0 items-center gap-2">
                                <Badge variant={statusVariant[run.status]}>{statusLabel[run.status]}</Badge>
                                <span className="text-muted-foreground">{triggerLabel[run.triggerKind]}</span>
                                <span className="truncate text-muted-foreground">{run.sourceId ?? "—"}</span>
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">{formatTime(run.createdAt)}</span>
                        </button>
                    </li>
                ))}
            </ul>
            {selected ? (
                <div className="flex flex-col gap-2 rounded-[var(--radius-panel)] border bg-muted/20 p-3">
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <dt>来源</dt>
                        <dd className="truncate text-right">{selected.sourceId ?? "—"}</dd>
                        <dt>触发</dt>
                        <dd className="text-right">{triggerLabel[selected.triggerKind]}</dd>
                        <dt>创建</dt>
                        <dd className="text-right">{formatTime(selected.createdAt)}</dd>
                        <dt>结束</dt>
                        <dd className="text-right">{formatTime(selected.finishedAt)}</dd>
                        <dt>条目</dt>
                        <dd className="text-right">{selected.itemCount}</dd>
                        {selected.error ? (
                            <>
                                <dt>错误</dt>
                                <dd className="truncate text-right text-destructive">{selected.error}</dd>
                            </>
                        ) : null}
                    </dl>
                    {/* OPS-002：Run 之下的 Job（状态、重试次数、错误）。Attempt 明细仍只在 API。 */}
                    <div className="flex flex-col gap-1" data-run-jobs={selected.id}>
                        <span className="text-xs font-medium text-muted-foreground">任务</span>
                        {jobsError ? (
                            <p role="alert" className="text-xs text-destructive">{jobsError}</p>
                        ) : jobs && jobs.runId === selected.id ? (
                            jobs.items.length === 0 ? (
                                <p className="text-xs text-muted-foreground">这个 Run 没有登记任务。</p>
                            ) : (
                                <ul className="flex flex-col gap-1">
                                    {jobs.items.map((job) => (
                                        <li
                                            key={job.id}
                                            className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-sm border bg-card px-2 py-1 text-xs"
                                        >
                                            <Badge variant={job.status === "failed_terminal" ? "destructive" : "secondary"}>
                                                {jobStatusLabel[job.status]}
                                            </Badge>
                                            <span className="text-muted-foreground">{job.kind}</span>
                                            <span className="text-muted-foreground">
                                                重试 {job.attempts}/{job.maxAttempts}
                                            </span>
                                            {(job.errorCode || job.error) && (
                                                <span className="min-w-0 truncate text-destructive">
                                                    {job.errorCode ?? job.error}
                                                </span>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            )
                        ) : (
                            <p className="text-xs text-muted-foreground">读取任务…</p>
                        )}
                    </div>
                    <RunControl
                        run={selected}
                        busy={busy}
                        result={lastResult}
                        onCancel={() => control(() => client.cancelRun(selected.id))}
                        onRecover={() => control(() => client.recoverRun(selected.id))}
                        onRerun={() => control(() => client.rerunRun(selected.id, {
                            idempotencyKey: `web-rerun:${selected.id}:${crypto.randomUUID()}`,
                        }))}
                    />
                    {controlError ? (
                        <p role="alert" className="text-xs text-destructive">{controlError}</p>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
