import { Play, Power, PowerOff } from "lucide-react";

import type { SourceSnapshot } from "@cosmos/contracts";

import { Button } from "@/components/ui/button";

type SourceActionsProps = {
    onRun: (source: SourceSnapshot) => Promise<void>;
    onToggleActivation: (source: SourceSnapshot, enabled: boolean) => Promise<void>;
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

/** 来源工作台：每行展示名称、启用状态与最近运行诊断；启用/停用与手动录入都在行内完成。 */
export function SourceActions({
    onRun,
    onToggleActivation,
    activatingSourceId = null,
    runningSourceId = null,
    sources,
}: SourceActionsProps) {
    return (
        <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
                <h2 className="font-display text-lg font-semibold tracking-tight">来源与录入</h2>
                <p className="text-sm text-muted-foreground">
                    {sources.length === 0 ? "创建第一个 RSS 来源。" : "启用来源后可执行手动录入。"}
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
                        return (
                            <li
                                key={source.id}
                                className="flex items-start justify-between gap-3 border-b py-3 first:pt-0 last:border-b-0 last:pb-0"
                            >
                                <div className="flex min-w-0 flex-col gap-0.5">
                                    <span className="truncate text-sm font-medium">{source.name}</span>
                                    <span
                                        title={`${source.kind} · ${source.sourceDefinitionRef}`}
                                        className="min-w-0 truncate text-xs text-muted-foreground"
                                    >
                                        {source.enabled ? "已启用" : "已停用"} · {source.kind} · {source.sourceDefinitionRef}
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
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}
