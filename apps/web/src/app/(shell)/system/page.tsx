"use client";

import { RefreshCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type { FeedItem } from "@cosmos/contracts";

import { client, readError } from "@/app/home/page-runtime";

import { Button } from "@/components/ui/button";
import { RunHistory } from "@/components/cosmos/run-history";
import { SystemOutputBlock } from "@/components/cosmos/system-output-block";
import { useLiveTopic } from "@/components/shell/live-provider";
import { messages } from "@/copy/messages";

/*
 * 系统产出。两件事：采集与 Workflow 的运行记录，以及由系统或 Agent 产生的 Story。
 *
 * 「谁写的」取每个 Story 当前 Revision 的 producer（ADR-0028）：`human` 表示这一版
 * 由人写过并已对自动写入方冻结，`system` / `agent` 表示机器产出。这里直接读 feed，
 * 不用 useFeedWorkspace——本页没有搜索与分页，不需要把整套检索状态拖进来。
 */
export default function SystemPage() {
    const router = useRouter();
    const [items, setItems] = useState<readonly FeedItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [runRefreshToken, setRunRefreshToken] = useState(0);

    const load = useCallback(async (): Promise<void> => {
        try {
            const page = await client.feed({ limit: 20 });
            setItems(page.items);
            setError(null);
        } catch (caught) {
            setError(readError(caught));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        // 首次读取：load 内部先 await 再 setState，不会在渲染期间同步触发级联渲染。
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load();
    }, [load]);

    /** 运行事件既刷新运行记录，也可能带来新的系统产出。 */
    useLiveTopic("automation", () => {
        void load();
        setRunRefreshToken((current) => current + 1);
    });

    return (
        <div className="flex w-full flex-col gap-6">
            <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-[15px] font-medium">{messages.pages.system.title}</h1>
                <span className="text-[12px] text-muted-foreground">
                    {messages.pages.system.description}
                </span>
                <Button
                    className="ml-auto"
                    disabled={loading}
                    onClick={() => {
                        void load();
                        setRunRefreshToken((current) => current + 1);
                    }}
                    size="sm"
                    variant="outline"
                >
                    <RefreshCcw data-icon="inline-start" />
                    {messages.common.refresh}
                </Button>
            </div>

            {error && (
                <div
                    className="rounded-[var(--radius-control)] border border-destructive/30 bg-destructive/10 p-3 text-[13px] leading-6 text-destructive"
                    role="alert"
                >
                    {error}
                </div>
            )}

            <SystemOutputBlock
                items={items}
                loading={loading}
                onOpenStory={(storyId) => router.push(`/stories/${encodeURIComponent(storyId)}`)}
            />

            <section
                aria-label={messages.pages.system.runHistory}
                className="flex flex-col gap-3 border-t border-border pt-5"
            >
                <h2 className="text-[15px] font-medium">{messages.pages.system.runHistory}</h2>
                <RunHistory client={client} refreshToken={runRefreshToken} />
            </section>
        </div>
    );
}
