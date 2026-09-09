"use client";

import { useEffect, useState, type ReactNode } from "react";

import type {
    BoardBlock,
    BoardDetail,
    CollectionDetail,
    CollectionSummary,
    SavedView,
    SpotlightPlacement,
    TopicSummary,
} from "@cosmos/contracts";
import type { HttpCosmosClient } from "@cosmos/transport-http";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const BLOCK_TYPE_LABELS: Record<string, string> = {
    feed: "阅读流",
    spotlight: "热点",
    "source-health": "来源健康",
    "topic-list": "Topic 列表",
    collection: "收藏夹",
};

const BLOCK_TYPE_OPTIONS = [
    "feed",
    "spotlight",
    "source-health",
    "topic-list",
    "collection",
] as const;

/** 只读的 config.limit 提取；非正整数一律回退默认值。 */
function blockLimit(block: BoardBlock, fallback: number): number {
    const raw = block.config.limit;
    if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) {
        return raw;
    }
    return fallback;
}

function configString(block: BoardBlock, key: string): string | null {
    const raw = block.config[key];
    return typeof raw === "string" && raw.trim() !== "" ? raw : null;
}

function blockTypeLabel(type: string): string {
    return BLOCK_TYPE_LABELS[type] ?? type;
}

function BlockPlaceholder({ text }: { text: string }) {
    return (
        <div className="flex flex-col items-center gap-1 rounded-[var(--radius-panel)] border border-dashed px-6 py-10 text-center">
            <p className="text-sm leading-6 text-muted-foreground">{text}</p>
        </div>
    );
}

export type BoardCommands = {
    createSection: (title: string) => Promise<void>;
    updateSection: (sectionId: string, input: { title: string; position?: number }) => Promise<void>;
    deleteSection: (sectionId: string) => Promise<void>;
    createBlock: (
        sectionId: string,
        type: string,
        config: Record<string, unknown>,
    ) => Promise<void>;
    updateBlockConfig: (blockId: string, config: Record<string, unknown>) => Promise<void>;
    deleteBlock: (blockId: string) => Promise<void>;
    moveBlock: (blockId: string, sectionId: string, position: number) => Promise<void>;
    setBlockVisibility: (blockId: string, visible: boolean) => Promise<void>;
    duplicateBlock: (blockId: string) => Promise<void>;
};

type BoardViewProps = {
    board: BoardDetail;
    client: HttpCosmosClient;
    /**
     * 完整阅读流（搜索卡 + Feed 列表 + 已保存视图）由页面持有状态，渲染在
     * 首个可见 feed 区块位置；多个 Feed 区块的自取数留给后续切片。
     */
    feedSlot: ReactNode;
    /** 来源健康区块复用页面的 SourceActions（含启用/停用/手动录入操作）。 */
    sourceActionsSlot: ReactNode;
    topics: readonly TopicSummary[];
    openingTopicId: string | null;
    onOpenTopic: (topicId: string) => void;
    onOpenStory: (storyId: string) => void;
    /** 编辑模式：显示分区/区块的增删改与排序控件（ADR-0010 决定 1）。 */
    editable?: boolean;
    commands?: BoardCommands;
    savedViews?: readonly SavedView[];
    collections?: readonly CollectionSummary[];
    /** 自取数区块（Spotlight）的刷新信号；pin 之后由页面递增。 */
    refreshToken?: number;
};

/**
 * 按 Board 树渲染首页主区：Section 顺序排列，Block 按 type 分发。区块是纯
 * 展示配置（ADR-0010）：渲染失败或引用悬空只降级占位，不影响其它区块。
 */
export function BoardView({
    board,
    client,
    feedSlot,
    sourceActionsSlot,
    topics,
    openingTopicId,
    onOpenTopic,
    onOpenStory,
    editable = false,
    commands,
    savedViews = [],
    collections = [],
    refreshToken = 0,
}: BoardViewProps) {
    const firstFeedBlockId = board.sections
        .flatMap((section) => section.blocks)
        .find((block) => block.type === "feed" && block.visible)?.id;

    return (
        <div className="flex flex-col gap-10">
            {board.sections.map((section, sectionIndex) => {
                const visibleBlocks = section.blocks.filter((block) => block.visible);
                return (
                    <section
                        key={section.id}
                        aria-label={section.title}
                        className="flex flex-col gap-5"
                        data-section-id={section.id}
                    >
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
                            {editable && commands ? (
                                <SectionEditor
                                    section={section}
                                    index={sectionIndex}
                                    total={board.sections.length}
                                    commands={commands}
                                />
                            ) : (
                                <h2 className="font-display text-xl font-semibold tracking-tight">
                                    {section.title}
                                </h2>
                            )}
                        </div>
                        {visibleBlocks.length === 0 && !editable ? (
                            <BlockPlaceholder text="该分区还没有可见区块。" />
                        ) : (
                            section.blocks.map((block, blockIndex) => (
                                <div
                                    key={block.id}
                                    data-block-id={block.id}
                                    data-block-type={block.type}
                                    className={block.visible ? "" : "opacity-60"}
                                >
                                    {editable && commands ? (
                                        <BlockEditor
                                            block={block}
                                            index={blockIndex}
                                            sections={board.sections}
                                            commands={commands}
                                            savedViews={savedViews}
                                            collections={collections}
                                        />
                                    ) : null}
                                    {block.visible ? (
                                        <BoardBlockContent
                                            block={block}
                                            client={client}
                                            boardId={board.id}
                                            feedSlot={block.id === firstFeedBlockId ? feedSlot : null}
                                            sourceActionsSlot={sourceActionsSlot}
                                            topics={topics}
                                            openingTopicId={openingTopicId}
                                            onOpenTopic={onOpenTopic}
                                            onOpenStory={onOpenStory}
                                            refreshToken={refreshToken}
                                        />
                                    ) : editable ? (
                                        // 隐藏只影响浏览视图；编辑模式保留占位，便于恢复。
                                        <BlockPlaceholder text={`已隐藏：${blockTypeLabel(block.type)}`} />
                                    ) : null}
                                </div>
                            ))
                        )}
                        {editable && commands ? (
                            <AddBlockForm
                                sectionId={section.id}
                                commands={commands}
                                savedViews={savedViews}
                                collections={collections}
                            />
                        ) : null}
                    </section>
                );
            })}
            {editable && commands ? (
                <AddSectionForm commands={commands} />
            ) : null}
        </div>
    );
}

function SectionEditor({
    section,
    index,
    total,
    commands,
}: {
    section: BoardDetail["sections"][number];
    index: number;
    total: number;
    commands: BoardCommands;
}) {
    const [title, setTitle] = useState(section.title);
    return (
        <div className="flex w-full flex-wrap items-center gap-2">
            <Input
                aria-label={`分区标题 ${section.title}`}
                className="max-w-xs"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onBlur={() => {
                    const trimmed = title.trim();
                    if (trimmed !== "" && trimmed !== section.title) {
                        void commands.updateSection(section.id, { title: trimmed });
                    } else if (trimmed === "") {
                        setTitle(section.title);
                    }
                }}
            />
            <Button
                size="xs"
                variant="outline"
                disabled={index === 0}
                aria-label={`上移分区 ${section.title}`}
                onClick={() => void commands.updateSection(section.id, {
                    title: section.title,
                    position: index - 1,
                })}
            >
                上移
            </Button>
            <Button
                size="xs"
                variant="outline"
                disabled={index === total - 1}
                aria-label={`下移分区 ${section.title}`}
                onClick={() => void commands.updateSection(section.id, {
                    title: section.title,
                    position: index + 1,
                })}
            >
                下移
            </Button>
            <Button
                size="xs"
                variant="ghost"
                aria-label={`删除分区 ${section.title}`}
                onClick={() => void commands.deleteSection(section.id)}
            >
                删除分区
            </Button>
        </div>
    );
}

function BlockEditor({
    block,
    index,
    sections,
    commands,
    savedViews,
    collections,
}: {
    block: BoardBlock;
    index: number;
    sections: BoardDetail["sections"];
    commands: BoardCommands;
    savedViews: readonly SavedView[];
    collections: readonly CollectionSummary[];
}) {
    const [limit, setLimit] = useState(String(blockLimit(block, 20)));
    const savedViewId = configString(block, "savedViewId") ?? "";
    const collectionId = configString(block, "collectionId") ?? "";

    const submitLimit = (): void => {
        const parsed = Number(limit);
        const next = Number.isInteger(parsed) && parsed > 0 ? parsed : 20;
        setLimit(String(next));
        void commands.updateBlockConfig(block.id, {
            ...block.config,
            limit: next,
        });
    };

    return (
        <div className="mb-2 flex flex-col gap-2 rounded-[var(--radius-control)] border border-dashed bg-muted/30 p-3">
            <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{blockTypeLabel(block.type)}</Badge>
                <Button
                    size="xs"
                    variant="outline"
                    disabled={index === 0}
                    aria-label={`上移区块 ${blockTypeLabel(block.type)}`}
                    onClick={() => void commands.moveBlock(block.id, block.sectionId, index - 1)}
                >
                    上移
                </Button>
                <Button
                    size="xs"
                    variant="outline"
                    disabled={index === block.position}
                    aria-label={`下移区块 ${blockTypeLabel(block.type)}`}
                    onClick={() => void commands.moveBlock(block.id, block.sectionId, index + 1)}
                >
                    下移
                </Button>
                <Button
                    size="xs"
                    variant="outline"
                    aria-label={`${block.visible ? "隐藏" : "显示"}区块 ${blockTypeLabel(block.type)}`}
                    onClick={() => void commands.setBlockVisibility(block.id, !block.visible)}
                >
                    {block.visible ? "隐藏" : "显示"}
                </Button>
                <Button
                    size="xs"
                    variant="outline"
                    aria-label={`复制区块 ${blockTypeLabel(block.type)}`}
                    onClick={() => void commands.duplicateBlock(block.id)}
                >
                    复制
                </Button>
                <Button
                    size="xs"
                    variant="ghost"
                    aria-label={`删除区块 ${blockTypeLabel(block.type)}`}
                    onClick={() => void commands.deleteBlock(block.id)}
                >
                    删除
                </Button>
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    移到
                    <select
                        aria-label={`移动区块 ${blockTypeLabel(block.type)}`}
                        className="h-7 rounded-lg border border-input bg-background px-1 text-xs"
                        value={block.sectionId}
                        onChange={(event) => {
                            const target = event.target.value;
                            if (target !== block.sectionId) {
                                void commands.moveBlock(block.id, target, 0);
                            }
                        }}
                    >
                        {sections.map((section) => (
                            <option key={section.id} value={section.id}>
                                {section.title}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    条数
                    <Input
                        aria-label={`区块条数 ${blockTypeLabel(block.type)}`}
                        className="h-7 w-16"
                        value={limit}
                        onChange={(event) => setLimit(event.target.value)}
                        onBlur={submitLimit}
                    />
                </label>
            </div>
            {block.type === "feed" ? (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    绑定视图
                    <select
                        aria-label="绑定保存视图"
                        className="h-7 rounded-lg border border-input bg-background px-1 text-xs"
                        value={savedViewId}
                        onChange={(event) => {
                            const next = event.target.value;
                            const config: Record<string, unknown> = { ...block.config, limit: blockLimit(block, 20) };
                            if (next === "") {
                                delete config.savedViewId;
                            } else {
                                config.savedViewId = next;
                            }
                            void commands.updateBlockConfig(block.id, config);
                        }}
                    >
                        <option value="">全部内容（不绑定）</option>
                        {savedViews.map((view) => (
                            <option key={view.id} value={view.id}>
                                {view.name}
                            </option>
                        ))}
                    </select>
                </label>
            ) : null}
            {block.type === "collection" ? (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    绑定收藏夹
                    <select
                        aria-label="绑定收藏夹"
                        className="h-7 rounded-lg border border-input bg-background px-1 text-xs"
                        value={collectionId}
                        onChange={(event) => {
                            void commands.updateBlockConfig(block.id, {
                                ...block.config,
                                collectionId: event.target.value,
                            });
                        }}
                    >
                        <option value="">请选择</option>
                        {collections.map((collection) => (
                            <option key={collection.id} value={collection.id}>
                                {collection.name}
                            </option>
                        ))}
                    </select>
                </label>
            ) : null}
        </div>
    );
}

function AddBlockForm({
    sectionId,
    commands,
    savedViews,
    collections,
}: {
    sectionId: string;
    commands: BoardCommands;
    savedViews: readonly SavedView[];
    collections: readonly CollectionSummary[];
}) {
    const [type, setType] = useState<string>("feed");
    const [savedViewId, setSavedViewId] = useState("");
    const [collectionId, setCollectionId] = useState("");
    return (
        <div className="flex flex-wrap items-center gap-2">
            <select
                aria-label="新增区块类型"
                className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                value={type}
                onChange={(event) => setType(event.target.value)}
            >
                {BLOCK_TYPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                        {blockTypeLabel(option)}
                    </option>
                ))}
            </select>
            {type === "feed" ? (
                <select
                    aria-label="新增区块绑定视图"
                    className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                    value={savedViewId}
                    onChange={(event) => setSavedViewId(event.target.value)}
                >
                    <option value="">全部内容（不绑定）</option>
                    {savedViews.map((view) => (
                        <option key={view.id} value={view.id}>
                            {view.name}
                        </option>
                    ))}
                </select>
            ) : null}
            {type === "collection" ? (
                <select
                    aria-label="新增区块绑定收藏夹"
                    className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                    value={collectionId}
                    onChange={(event) => setCollectionId(event.target.value)}
                >
                    <option value="">暂不绑定（稍后在区块配置里选）</option>
                    {collections.map((collection) => (
                        <option key={collection.id} value={collection.id}>
                            {collection.name}
                        </option>
                    ))}
                </select>
            ) : null}
            <Button
                size="sm"
                variant="outline"
                onClick={() => {
                    // 绑定是可选的（ADR-0010 决定 5）：未绑定的 feed 渲染全部内容，
                    // 未绑定的 collection 渲染占位，都可在区块配置里补齐。
                    const config: Record<string, unknown> = {};
                    if (type === "feed" && savedViewId !== "") {
                        config.savedViewId = savedViewId;
                    }
                    if (type === "collection" && collectionId !== "") {
                        config.collectionId = collectionId;
                    }
                    setSavedViewId("");
                    setCollectionId("");
                    void commands.createBlock(sectionId, type, config);
                }}
            >
                添加区块
            </Button>
        </div>
    );
}

function AddSectionForm({ commands }: { commands: BoardCommands }) {
    const [title, setTitle] = useState("");
    return (
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            <Input
                aria-label="新分区标题"
                className="max-w-xs"
                placeholder="新分区标题"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
            />
            <Button
                size="sm"
                variant="outline"
                disabled={title.trim() === ""}
                onClick={() => {
                    const trimmed = title.trim();
                    setTitle("");
                    void commands.createSection(trimmed);
                }}
            >
                添加分区
            </Button>
        </div>
    );
}

type BoardBlockContentProps = {
    block: BoardBlock;
    client: HttpCosmosClient;
    boardId: string;
    feedSlot: ReactNode | null;
    sourceActionsSlot: ReactNode;
    topics: readonly TopicSummary[];
    openingTopicId: string | null;
    onOpenTopic: (topicId: string) => void;
    onOpenStory: (storyId: string) => void;
    refreshToken: number;
};

function BoardBlockContent({
    block,
    client,
    boardId,
    feedSlot,
    sourceActionsSlot,
    topics,
    openingTopicId,
    onOpenTopic,
    onOpenStory,
    refreshToken,
}: BoardBlockContentProps) {
    switch (block.type) {
        case "feed":
            return feedSlot ?? (
                <BlockPlaceholder text="此阅读流区块将在后续切片支持独立取数与配置。" />
            );
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
            return <>{sourceActionsSlot}</>;
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
                        {placement.targetTitle ?? placement.targetId}
                    </button>
                    <Button
                        size="xs"
                        variant="ghost"
                        aria-label={`解除固定 ${placement.targetTitle ?? placement.targetId}`}
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
