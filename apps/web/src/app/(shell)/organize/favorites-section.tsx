"use client";

import { Star } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { FavoriteItem } from "@cosmos/contracts";

import { client, readError } from "@/app/home/page-runtime";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

import { ItemBlock, SectionMessage, SectionShell } from "./section-parts";

/*
 * 收藏分区。这是「收藏」这个动作第一次有地方可看——在此之前 Story 抽屉的文案承诺
 * 「收藏后可在收藏列表快速找回」，但界面上没有收藏列表（ui-copy-review-v1 把它记为
 * 「承诺与界面不符」）。
 *
 * 标题来自切片 3a 的读取侧投影；目标已被删除时标题为 null，界面按「已读不到」表达，
 * 不把裸 ID 当标题显示。
 */
export function FavoritesSection() {
    const toast = useToast();
    const [items, setItems] = useState<readonly FavoriteItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async (): Promise<void> => {
        try {
            setItems((await client.listFavorites()).items);
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

    const remove = async (item: FavoriteItem): Promise<void> => {
        try {
            await client.unsetFavorite({ targetType: item.targetType, targetId: item.targetId });
            await load();
            toast.success({ title: "已取消收藏" });
        } catch (caught) {
            toast.error({ title: "取消收藏失败", description: readError(caught) });
        }
    };

    return (
        <SectionShell
            count={loading ? null : items.length}
            summary="标了星的内容；收藏在 Story 页随手点，这里用来回收"
            title="收藏"
        >
            {error ? (
                <SectionMessage kind="error">{error}</SectionMessage>
            ) : loading ? (
                <SectionMessage kind="loading">正在读取…</SectionMessage>
            ) : items.length === 0 ? (
                <SectionMessage kind="empty">
                    还没有收藏。读一条内容时点「收藏」，它会出现在这里。
                </SectionMessage>
            ) : (
                <ul className="flex flex-col">
                    {items.map((item) => (
                        <ItemBlock key={`${item.targetType}:${item.targetId}`}>
                            <Star
                                aria-hidden
                                className="mt-0.5 size-3.5 shrink-0 fill-primary text-primary"
                                strokeWidth={1.75}
                            />
                            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <span className="truncate text-[14px]">
                                    {item.title ?? "这条内容已经读不到了"}
                                </span>
                                <span className="text-[11px] text-muted-foreground">
                                    {item.targetType === "story" ? "内容" : "条目"} ·
                                    收藏于 {item.createdAt.slice(0, 10)}
                                </span>
                            </div>
                            <Button
                                onClick={() => void remove(item)}
                                size="sm"
                                variant="outline"
                            >
                                取消收藏
                            </Button>
                        </ItemBlock>
                    ))}
                </ul>
            )}
        </SectionShell>
    );
}
