import type { HealthResponse } from "@cosmos/contracts";

import { RadioTower, Unplug } from "lucide-react";

export type EventStreamState = "connecting" | "connected" | "unavailable";

type StatusSummaryProps = {
    eventStreamState: EventStreamState;
    health: HealthResponse | null;
    sourceSummary: string;
};

const EVENT_STREAM_COPY: Record<EventStreamState, { detail?: string; label: string }> = {
    connected: { label: "SSE 已连接" },
    connecting: { label: "正在连接" },
    unavailable: {
        detail: "数据仍可手动刷新；服务恢复后会重新连接。",
        label: "SSE 不可用",
    },
};

/** 紧凑状态带：替代原首屏四张状态卡，信息保留但只占一行行高。 */
export function StatusSummary({ eventStreamState, health, sourceSummary }: StatusSummaryProps) {
    const stream = EVENT_STREAM_COPY[eventStreamState];

    return (
        <section
            aria-label="状态摘要"
            className="flex min-w-0 flex-col gap-2.5 overflow-hidden rounded-[var(--radius-panel)] border bg-card px-4 py-3"
        >
            <div className="flex min-w-0 items-center justify-between gap-3 text-sm">
                <span className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">服务</span>
                <span className="min-w-0 truncate font-medium">
                    {health ? `${health.service} · ${health.workerStatus}` : "Next.js Web · NestJS API · Worker"}
                </span>
            </div>
            <div className="flex min-w-0 items-center justify-between gap-3 text-sm">
                <span className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">来源</span>
                <span className="min-w-0 truncate font-medium">{sourceSummary}</span>
            </div>
            <div className="flex min-w-0 items-center justify-between gap-3 text-sm">
                <span className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">数据层</span>
                <span className="min-w-0 truncate text-muted-foreground">
                    Prisma + SQLite，已保存内容在上游断开后仍可查询。
                </span>
            </div>
            <div className="flex min-w-0 items-center justify-between gap-3 text-sm">
                <span className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">实时</span>
                <span className="flex min-w-0 items-center gap-1.5">
                    {eventStreamState === "unavailable" ? (
                        <Unplug aria-hidden={true} className="size-3.5 shrink-0 text-destructive" />
                    ) : (
                        <RadioTower aria-hidden={true} className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 truncate font-medium">{stream.label}</span>
                </span>
            </div>
            {stream.detail && (
                <p className="text-xs leading-5 text-muted-foreground">{stream.detail}</p>
            )}
        </section>
    );
}
