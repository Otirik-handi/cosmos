import { useEffect, useState, type ReactNode } from "react";

import type {
    BoardBlock,
    CollectionDetail,
    FeedItem,
    SavedView,
    SpotlightPlacement,
    TopicSummary,
} from "@cosmos/contracts";
import type { HttpCosmosClient } from "@cosmos/transport-http";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { BlockPlaceholder, blockLimit, configString } from "./shared";


type BoardBlockContentProps = {
    block: BoardBlock;
    client: HttpCosmosClient;
    boardId: string;
    planListSlot: ReactNode;
    savedViews: readonly SavedView[];
    topics: readonly TopicSummary[];
    openingTopicId: string | null;
    onOpenTopic: (topicId: string) => void;
    onOpenStory: (storyId: string) => void;
    refreshToken: number;
};

export function BoardBlockContent({
    block,
    client,
    boardId,
    planListSlot,
    savedViews,
    topics,
    openingTopicId,
    onOpenTopic,
    onOpenStory,
    refreshToken,
}: BoardBlockContentProps) {
    switch (block.type) {
        case "feed": {
            const savedViewId = configString(block, "savedViewId");
            // 悬空引用（视图被删）降级占位；未绑定不是错误，按最新内容流渲染
            // （ADR-0010 决定 5，按维护者 2026-09-15 裁定收窄为「悬空才占位」）。
            if (savedViewId && !savedViews.some((view) => view.id === savedViewId)) {
                return <BlockPlaceholder text="绑定的已保存视图不存在或已被删除。" />;
            }
            const savedView = savedViews.find((view) => view.id === savedViewId) ?? null;
            return (
                <BoardFeedBlock
                    key={savedView?.id ?? "latest"}
                    client={client}
                    savedView={savedView}
                    limit={blockLimit(block, 5)}
                    onOpenStory={onOpenStory}
                />
            );
        }
        case "spotlight":
            return (
                <BoardSpotlightBlock
                    client={client}
                    boardId={boardId}
                    onOpenStory={onOpenStory}
                    onOpenTopic={onOpenTopic}
                    refreshToken={refreshToken}
                />
            );
        case "source-health":
            return <>{planListSlot}</>;
        case "topic-list":
            return (
                <BoardTopicListBlock
                    topics={topics.slice(0, blockLimit(block, 20))}
                    openingTopicId={openingTopicId}
                    onOpenTopic={onOpenTopic}
                />
            );
        case "collection": {
            const collectionId = configString(block, "collectionId");
            if (!collectionId) {
                return <BlockPlaceholder text="此区块尚未绑定收藏夹；可在编辑模式中选择。" />;
            }
            return (
                <BoardCollectionBlock
                    key={collectionId}
                    client={client}
                    collectionId={collectionId}
                    limit={blockLimit(block, 20)}
                    onOpenStory={onOpenStory}
                />
            );
        }
        default:
            return <BlockPlaceholder text={`未知区块类型：${block.type}，可在编辑模式中移除。`} />;
    }
}

type BoardTopicListBlockProps = {
    topics: readonly TopicSummary[];
    openingTopicId: string | null;
    onOpenTopic: (topicId: string) => void;
};

function BoardTopicListBlock({ topics, openingTopicId, onOpenTopic }: BoardTopicListBlockProps) {
    if (topics.length === 0) {
        return <BlockPlaceholder text="尚未创建 Topic；在 Story 详情里可创建并加入。" />;
    }
    return (
        <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {topics.map((item) => (
                <li key={item.id}>
                    <button
                        type="button"
                        data-topic-id={item.id}
                        disabled={openingTopicId === item.id}
                        onClick={() => onOpenTopic(item.id)}
                        className="flex w-full items-center justify-between gap-2 rounded-sm border bg-card px-3 py-2 text-left text-sm hover:bg-muted/40 focus-visible:border-ring focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none disabled:opacity-60"
                    >
                        <span className="truncate">{item.title}</span>
                        <Badge variant="secondary">{item.memberCount}</Badge>
                    </button>
                </li>
            ))}
        </ul>
    );
}

type BoardFeedBlockProps = {
    client: HttpCosmosClient;
    /** 绑定的已保存视图；null 表示未绑定。 */
    savedView: SavedView | null;
    limit: number;
    onOpenStory: (storyId: string) => void;
};

/**
 * 阅读流区块：自取数据并渲染紧凑内容流。未绑定视图时取最新内容，绑定后按该视图
 * 的条件取数——每个区块各自取数，互不干扰。父组件按绑定传 key：绑定切换时整体
 * 重挂载，状态回到 loading，effect 内不做同步 setState（同收藏夹区块）。
 */
function BoardFeedBlock({ client, savedView, limit, onOpenStory }: BoardFeedBlockProps) {
    const [items, setItems] = useState<readonly FeedItem[]>([]);
    const [state, setState] = useState<"loading" | "loaded" | "failed">("loading");

    useEffect(() => {
        let cancelled = false;
        const request = savedView
            ? client.search({
                text: savedView.text ?? undefined,
                sourceId: savedView.sourceId ?? undefined,
                publishedAfter: savedView.publishedAfter ?? undefined,
                publishedBefore: savedView.publishedBefore ?? undefined,
                labelIds: savedView.labelIds.join(",") || undefined,
                topicIds: savedView.topicIds.join(",") || undefined,
                limit,
            })
            : client.feed({ limit });
        request
            .then((result) => {
                if (!cancelled) {
                    setItems(result.items);
                    setState("loaded");
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setState("failed");
                }
            });
        return () => {
            cancelled = true;
        };
    }, [client, limit, savedView]);

    if (state === "loading") {
        return <BlockPlaceholder text="正在读取内容流…" />;
    }
    if (state === "failed") {
        return <BlockPlaceholder text="内容流读取失败；稍后可刷新重试。" />;
    }
    if (items.length === 0) {
        return (
            <BlockPlaceholder
                text={savedView
                    ? `视图「${savedView.name}」没有匹配的内容。`
                    : "还没有已录入的内容。"}
            />
        );
    }
    return (
        <div className="flex flex-col gap-2">
            {savedView && (
                <p className="text-xs text-muted-foreground">视图「{savedView.name}」</p>
            )}
            <ul className="grid gap-1">
                {items.map((item) => (
                    // 同一 Story 可以有多张成员卡片，key 用条目身份（同 FeedBrowser）。
                    <li key={item.entryId}>
                        <button
                            type="button"
                            onClick={() => onOpenStory(item.storyId)}
                            className="flex w-full flex-col rounded-sm border bg-card px-3 py-2 text-left hover:bg-muted/40 focus-visible:border-ring focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none"
                        >
                            <span className="truncate text-sm">{item.title}</span>
                            <span className="text-xs text-muted-foreground">{item.sourceName}</span>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}

type BoardCollectionBlockProps = {
    client: HttpCosmosClient;
    collectionId: string;
    limit: number;
    onOpenStory: (storyId: string) => void;
};

/**
 * 命名收藏夹区块：自取收藏夹详情并渲染成员 Story。收藏夹被删除时降级占位
 * （ADR-0010 决定 5），不硬报错。父组件按 collectionId 传入 key：绑定切换
 * 时整体重挂载，状态回到 loading，effect 内不做同步 setState。
 */
function BoardCollectionBlock({ client, collectionId, limit, onOpenStory }: BoardCollectionBlockProps) {
    const [detail, setDetail] = useState<CollectionDetail | null>(null);
    const [state, setState] = useState<"loading" | "loaded" | "missing">("loading");

    useEffect(() => {
        let cancelled = false;
        client.collection(collectionId)
            .then((result) => {
                if (!cancelled) {
                    setDetail(result);
                    setState("loaded");
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setState("missing");
                }
            });
        return () => {
            cancelled = true;
        };
    }, [client, collectionId]);

    if (state === "loading") {
        return <BlockPlaceholder text="正在读取收藏夹…" />;
    }
    if (state === "missing" || !detail) {
        return <BlockPlaceholder text="绑定的收藏夹不存在或已被删除。" />;
    }
    if (detail.stories.length === 0) {
        return <BlockPlaceholder text={`收藏夹「${detail.name}」还没有成员 Story。`} />;
    }
    return (
        <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">收藏夹「{detail.name}」</p>
            <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                {detail.stories.slice(0, limit).map((story) => (
                    <li key={story.storyId}>
                        <button
                            type="button"
                            onClick={() => onOpenStory(story.storyId)}
                            className="flex w-full items-center rounded-sm border bg-card px-3 py-2 text-left text-sm hover:bg-muted/40 focus-visible:border-ring focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none"
                        >
                            <span className="truncate">{story.title}</span>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}

type BoardSpotlightBlockProps = {
    client: HttpCosmosClient;
    boardId: string;
    onOpenStory: (storyId: string) => void;
    onOpenTopic: (topicId: string) => void;
    refreshToken: number;
};

/**
 * 人工固定 Spotlight 区块：自取本 Board 的 active placements（附带目标标题），
 * 点击打开目标、可逐项解除。自动 policy 推荐后置 Phase 4（REC-014）。
 */
function BoardSpotlightBlock({
    client,
    boardId,
    onOpenStory,
    onOpenTopic,
    refreshToken,
}: BoardSpotlightBlockProps) {
    const [placements, setPlacements] = useState<readonly SpotlightPlacement[] | null>(null);
    const [state, setState] = useState<"loading" | "loaded" | "error">("loading");

    const load = (): void => {
        client.listSpotlightPlacements({ boardId })
            .then((list) => {
                setPlacements(list.items);
                setState("loaded");
            })
            .catch(() => {
                setState("error");
            });
    };

    useEffect(() => {
        let cancelled = false;
        client.listSpotlightPlacements({ boardId })
            .then((list) => {
                if (!cancelled) {
                    setPlacements(list.items);
                    setState("loaded");
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setState("error");
                }
            });
        return () => {
            cancelled = true;
        };
    }, [client, boardId, refreshToken]);

    if (state === "loading") {
        return <BlockPlaceholder text="正在读取固定内容…" />;
    }
    if (state === "error") {
        return <BlockPlaceholder text="固定内容读取失败。" />;
    }
    if (!placements || placements.length === 0) {
        return <BlockPlaceholder text="暂无固定内容；在 Story/Topic 详情中固定后会在热点区展示。" />;
    }
    return (
        <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {placements.map((placement) => (
                <li
                    key={placement.id}
                    data-placement-id={placement.id}
                    className="flex items-center justify-between gap-2 rounded-sm border bg-card px-3 py-2 text-sm"
                >
                    <button
                        type="button"
                        onClick={() => {
                            if (placement.targetType === "story") {
                                onOpenStory(placement.targetId);
                            } else if (placement.targetType === "topic") {
                                onOpenTopic(placement.targetId);
                            }
                        }}
                        className="min-w-0 flex-1 truncate text-left hover:text-primary focus-visible:border-ring focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none"
                    >
                        <Badge variant="secondary" className="mr-2">
                            {placement.targetType === "story" ? "Story" : "Topic"}
                        </Badge>
                        {placement.targetTitle ?? "（目标已不可读）"}
                    </button>
                    <Button
                        size="xs"
                        variant="ghost"
                        aria-label={`解除固定 ${placement.targetTitle ?? "这条内容"}`}
                        onClick={() => {
                            void client.unpinSpotlight(placement.id).then(() => {
                                load();
                            });
                        }}
                    >
                        解除
                    </Button>
                </li>
            ))}
        </ul>
    );
}
