import type { ComponentProps } from "react";

import { Ban, RefreshCw, RotateCcw } from "lucide-react";

import type { RunControlResult, RunSnapshot } from "@cosmos/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const statusLabel: Record<RunSnapshot["status"], string> = {
    queued: "排队中",
    running: "运行中",
    succeeded: "成功",
    failed: "失败",
    cancelled: "已取消",
};

const statusVariant = {
    queued: "secondary",
    running: "secondary",
    succeeded: "default",
    failed: "destructive",
    cancelled: "outline",
} as const satisfies Record<RunSnapshot["status"], NonNullable<ComponentProps<typeof Badge>["variant"]>>;

type RunControlProps = {
    run: RunSnapshot;
    busy?: boolean;
    /** 最近一次控制动作的解释结果（复用/新副作用），有则展示给用户。 */
    result?: RunControlResult | null;
    onCancel: () => void;
    onRecover: () => void;
    onRerun: () => void;
};

/**
 * Run 控制面板（RUN-004）：取消、从安全步骤恢复、重新运行。取消/恢复只对
 * 非终态 Run 开放，重新运行只对终态 Run 开放；每个动作返回的解释直接展示，
 * 让用户看到会复用哪些结果、产生哪些新副作用。
 */
export function RunControl({ run, busy = false, result, onCancel, onRecover, onRerun }: RunControlProps) {
    const terminal = run.status === "succeeded" || run.status === "failed" || run.status === "cancelled";

    return (
        <section
            aria-label="Run 控制"
            className="flex min-w-0 flex-col gap-2.5 rounded-[var(--radius-panel)] border bg-card px-4 py-3"
        >
            <div className="flex min-w-0 items-center justify-between gap-3">
                <span className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">Run</span>
                <span className="flex min-w-0 items-center gap-2">
                    <Badge variant={statusVariant[run.status]}>{statusLabel[run.status]}</Badge>
                    <span className="truncate font-mono text-xs text-muted-foreground">{run.id}</span>
                </span>
            </div>
            <div className="flex flex-wrap gap-2">
                <Button size="xs" variant="outline" disabled={busy || terminal} onClick={onCancel}>
                    <Ban aria-hidden={true} className="size-3.5" />
                    取消
                </Button>
                <Button size="xs" variant="outline" disabled={busy || terminal} onClick={onRecover}>
                    <RotateCcw aria-hidden={true} className="size-3.5" />
                    恢复
                </Button>
                <Button size="xs" variant="outline" disabled={busy || !terminal} onClick={onRerun}>
                    <RefreshCw aria-hidden={true} className="size-3.5" />
                    重新运行
                </Button>
            </div>
            {result && (
                <div className="flex flex-col gap-1 text-xs leading-5 text-muted-foreground">
                    <p>复用：{result.reuse}</p>
                    <p>副作用：{result.sideEffects}</p>
                </div>
            )}
        </section>
    );
}
