import { useState } from "react";

import type {
    BoardBlock,
    BoardDetail,
    CollectionSummary,
    SavedView,
} from "@cosmos/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

import { BLOCK_TYPE_OPTIONS, blockLimit, blockTypeLabel, configString } from "./shared";
import type { BoardCommands } from "./types";


export function SectionEditor({
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

export function BlockEditor({
    block,
    index,
    total,
    sections,
    commands,
    savedViews,
    collections,
}: {
    block: BoardBlock;
    index: number;
    total: number;
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
                    disabled={index === total - 1}
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

export function AddBlockForm({
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

export function AddSectionForm({ commands }: { commands: BoardCommands }) {
    const [title, setTitle] = useState("");
    return (
        <div className="flex flex-wrap items-center gap-2">
            <Separator decorative />
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
