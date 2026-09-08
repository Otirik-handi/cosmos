import { ExternalLink, Image as ImageIcon, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEventHandler } from "react";

import type {
    AssetSnapshot,
    CollectionSummary,
    EntitySummary,
    LabelRef,
    StoryDetail,
    StoryEntitySummary,
    TopicMemberRole,
    TopicSummary,
    UpdateStoryRevisionCommand,
} from "@cosmos/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ROLE_OPTIONS } from "@/components/cosmos/topic-panel";
import {
    ENTITY_TYPE_OPTIONS,
    entityTypeLabel,
} from "@/components/cosmos/entity-panel";

type StoryPanelProps = {
    onClose: () => void;
    story: StoryDetail;
    onUpdateStoryRevision: (command: UpdateStoryRevisionCommand) => Promise<void>;
    onMergeStory: (obsoleteStoryId: string) => Promise<void>;
    topics?: readonly TopicSummary[];
    onJoinTopic?: (topicId: string, role: TopicMemberRole) => Promise<void>;
    onCreateTopic?: (title: string, purpose: string) => Promise<void>;
    entityOptions?: readonly EntitySummary[];
    onLinkEntity?: (entityId: string) => Promise<void>;
    onCreateEntityLinked?: (name: string, type: string) => Promise<void>;
    onUnlinkEntity?: (entityId: string) => Promise<void>;
    labelOptions?: readonly LabelRef[];
    collections?: readonly Pick<CollectionSummary, "id" | "name" | "containsStory">[];
    onToggleFavorite?: (favorited: boolean) => Promise<void>;
    onAttachLabel?: (labelId: string) => Promise<void>;
    onDetachLabel?: (labelId: string) => Promise<void>;
    onCreateLabel?: (name: string) => Promise<void>;
    onToggleCollection?: (collectionId: string, member: boolean) => Promise<void>;
    onCreateCollection?: (name: string) => Promise<void>;
};

function EntityRow({
    link,
    busy,
    onUnlink,
}: {
    link: StoryEntitySummary;
    busy: boolean;
    onUnlink: (entityId: string) => Promise<void>;
}) {
    return (
        <li
            data-story-entity-id={link.entityId}
            className="flex flex-wrap items-center gap-2 border-t py-3 first:border-t-0"
        >
            <Badge variant="secondary">{entityTypeLabel(link.type)}</Badge>
            <span className="min-w-0 flex-1 truncate text-sm">{link.name}</span>
            <span className="text-xs text-muted-foreground">{link.entityId}</span>
            {link.actor && (
                <span className="text-xs text-muted-foreground">· {link.actor}</span>
            )}
            <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void onUnlink(link.entityId)}
            >
                解除关联
            </Button>
        </li>
    );
}

const KIND_LABELS: Record<string, string> = {
    image: "图片",
    audio: "音频",
    video: "视频",
    enclosure: "附件",
};

const STATUS_LABELS: Record<AssetSnapshot["status"], string> = {
    saved: "已保存",
    metadata_only: "仅记录元数据",
    skipped: "未保存",
    failed: "保存失败",
};

function formatBytes(value: number | null): string | null {
    if (value === null) {
        return null;
    }
    if (value >= 1024 * 1024) {
        return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${Math.max(1, Math.round(value / 1024))} KB`;
}

function kindLabel(kind: string): string {
    return KIND_LABELS[kind] ?? kind;
}

/**
 * 附件区：已保存媒体用站内图片展示（断网可读），其余状态给出真实降级
 * 文案与原因，并保留原文外链，不伪造离线成功（ADR-0005）。
 */
function RevisionAssets({ assets }: { assets: readonly AssetSnapshot[] }) {
    if (assets.length === 0) {
        return null;
    }
    return (
        <section aria-label="媒体" className="grid gap-3 border-t pt-4">
            {assets.map((asset) => {
                const label = kindLabel(asset.kind);
                if (asset.status === "saved") {
                    return (
                        <figure
                            key={asset.id}
                            className="overflow-hidden rounded-sm border bg-muted/40"
                            data-asset-status="saved"
                            data-asset-id={asset.id}
                        >
                            <img
                                src={`/api/v1/assets/${asset.id}`}
                                alt={`已保存${label}`}
                                className="max-h-96 w-full object-contain"
                                loading="lazy"
                            />
                            <figcaption className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                                <ImageIcon aria-hidden={true} className="size-3.5" />
                                已保存本地，可离线查看
                                {formatBytes(asset.byteSize) && (
                                    <span>· {formatBytes(asset.byteSize)}</span>
                                )}
                            </figcaption>
                        </figure>
                    );
                }
                const reason = asset.errorMessage
                    ?? (asset.status === "metadata_only"
                        ? "按策略仅记录元数据"
                        : asset.status === "skipped"
                            ? "超过预算或被策略拦截"
                            : "下载失败");
                return (
                    <p
                        key={asset.id}
                        className="flex flex-wrap items-center gap-2 text-sm"
                        data-asset-status={asset.status}
                        data-asset-id={asset.id}
                    >
                        <span className="text-muted-foreground">{label}</span>
                        <Badge variant="secondary">{STATUS_LABELS[asset.status]}</Badge>
                        <span className="text-muted-foreground">{reason}</span>
                        {asset.sourceUrl && (
                            <a
                                href={asset.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 rounded-sm text-primary underline-offset-4 hover:underline focus-visible:border-ring focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none"
                            >
                                <ExternalLink aria-hidden={true} className="size-3.5" />
                                查看原文外链
                            </a>
                        )}
                    </p>
                );
            })}
        </section>
    );
}

/**
 * 阅读抽屉：固定定位的响应式阅读层，不依赖 Dialog 原语。
 * 打开时焦点进入关闭按钮，Escape 关闭，卸载时把焦点还给触发按钮。
 */
export function StoryPanel({
    onClose,
    story,
    onUpdateStoryRevision,
    onMergeStory,
    topics,
    onJoinTopic,
    onCreateTopic,
    entityOptions,
    onLinkEntity,
    onCreateEntityLinked,
    onUnlinkEntity,
    labelOptions,
    collections,
    onToggleFavorite,
    onAttachLabel,
    onDetachLabel,
    onCreateLabel,
    onToggleCollection,
    onCreateCollection,
}: StoryPanelProps) {
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const onCloseRef = useRef(onClose);
    const [title, setTitle] = useState(story.story.title);
    const [mergeStoryId, setMergeStoryId] = useState("");
    const [actionError, setActionError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [joinTopicId, setJoinTopicId] = useState("");
    const [joinRole, setJoinRole] = useState<TopicMemberRole>("core");
    const [newTopicTitle, setNewTopicTitle] = useState("");
    const [newTopicPurpose, setNewTopicPurpose] = useState("");
    const [linkEntityId, setLinkEntityId] = useState("");
    const [newEntityName, setNewEntityName] = useState("");
    const [newEntityType, setNewEntityType] = useState("person");
    const [attachLabelId, setAttachLabelId] = useState("");
    const [newLabelName, setNewLabelName] = useState("");
    const [newCollectionName, setNewCollectionName] = useState("");

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        const previousFocus = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        closeButtonRef.current?.focus();
        const handleKeyDown = (event: KeyboardEvent): void => {
            if (event.key === "Escape") {
                event.stopPropagation();
                onCloseRef.current();
            }
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            previousFocus?.focus();
        };
    }, []);

    const currentRevision = story.entry.revisions[0];
    const currentWebUrl = currentRevision?.webUrl ?? null;
    const submitRevisionUpdate: FormEventHandler = async (event) => {
        event.preventDefault();
        const normalized = title.trim();
        if (!normalized) {
            return;
        }
        setBusy(true);
        setActionError(null);
        try {
            await onUpdateStoryRevision({
                baseRevisionId: story.story.revisionId,
                title: normalized,
                summary: story.story.summary,
                kind: story.story.kind,
                subtype: story.story.subtype,
            });
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Story 操作失败。");
        } finally {
            setBusy(false);
        }
    };
    const submitMerge: FormEventHandler = async (event) => {
        event.preventDefault();
        const obsoleteStoryId = mergeStoryId.trim();
        if (!obsoleteStoryId) {
            return;
        }
        setBusy(true);
        setActionError(null);
        try {
            await onMergeStory(obsoleteStoryId);
            setMergeStoryId("");
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Story 归并失败。");
        } finally {
            setBusy(false);
        }
    };

    const submitJoinTopic = async (): Promise<void> => {
        if (!onJoinTopic || !joinTopicId) {
            return;
        }
        setBusy(true);
        setActionError(null);
        try {
            await onJoinTopic(joinTopicId, joinRole);
            setJoinTopicId("");
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "加入 Topic 失败。");
        } finally {
            setBusy(false);
        }
    };

    const submitCreateTopic = async (): Promise<void> => {
        if (!onCreateTopic) {
            return;
        }
        const normalizedTitle = newTopicTitle.trim();
        const normalizedPurpose = newTopicPurpose.trim();
        if (!normalizedTitle || !normalizedPurpose) {
            return;
        }
        setBusy(true);
        setActionError(null);
        try {
            await onCreateTopic(normalizedTitle, normalizedPurpose);
            setNewTopicTitle("");
            setNewTopicPurpose("");
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "创建 Topic 失败。");
        } finally {
            setBusy(false);
        }
    };

    const submitLinkEntity = async (): Promise<void> => {
        if (!onLinkEntity || !linkEntityId) {
            return;
        }
        setBusy(true);
        setActionError(null);
        try {
            await onLinkEntity(linkEntityId);
            setLinkEntityId("");
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "关联 Entity 失败。");
        } finally {
            setBusy(false);
        }
    };

    const submitCreateEntity = async (): Promise<void> => {
        if (!onCreateEntityLinked) {
            return;
        }
        const normalizedName = newEntityName.trim();
        if (!normalizedName) {
            return;
        }
        setBusy(true);
        setActionError(null);
        try {
            await onCreateEntityLinked(normalizedName, newEntityType);
            setNewEntityName("");
            setNewEntityType("person");
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "创建 Entity 失败。");
        } finally {
            setBusy(false);
        }
    };

    const submitUnlinkEntity = async (entityId: string): Promise<void> => {
        if (!onUnlinkEntity) {
            return;
        }
        setBusy(true);
        setActionError(null);
        try {
            await onUnlinkEntity(entityId);
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "解除 Entity 关联失败。");
        } finally {
            setBusy(false);
        }
    };

    const submitToggleFavorite = async (): Promise<void> => {
        if (!onToggleFavorite) {
            return;
        }
        setBusy(true);
        setActionError(null);
        try {
            await onToggleFavorite(!story.favorited);
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "更新收藏失败。");
        } finally {
            setBusy(false);
        }
    };

    const submitAttachLabel = async (): Promise<void> => {
        if (!onAttachLabel || !attachLabelId) {
            return;
        }
        setBusy(true);
        setActionError(null);
        try {
            await onAttachLabel(attachLabelId);
            setAttachLabelId("");
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "添加标签失败。");
        } finally {
            setBusy(false);
        }
    };

    const submitDetachLabel = async (labelId: string): Promise<void> => {
        if (!onDetachLabel) {
            return;
        }
        setBusy(true);
        setActionError(null);
        try {
            await onDetachLabel(labelId);
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "移除标签失败。");
        } finally {
            setBusy(false);
        }
    };

    const submitCreateLabel = async (): Promise<void> => {
        if (!onCreateLabel) {
            return;
        }
        const normalizedName = newLabelName.trim();
        if (!normalizedName) {
            return;
        }
        setBusy(true);
        setActionError(null);
        try {
            await onCreateLabel(normalizedName);
            setNewLabelName("");
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "创建标签失败。");
        } finally {
            setBusy(false);
        }
    };

    const submitToggleCollection = async (
        collectionId: string,
        member: boolean,
    ): Promise<void> => {
        if (!onToggleCollection) {
            return;
        }
        setBusy(true);
        setActionError(null);
        try {
            await onToggleCollection(collectionId, member);
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "更新收藏夹失败。");
        } finally {
            setBusy(false);
        }
    };

    const submitCreateCollection = async (): Promise<void> => {
        if (!onCreateCollection) {
            return;
        }
        const normalizedName = newCollectionName.trim();
        if (!normalizedName) {
            return;
        }
        setBusy(true);
        setActionError(null);
        try {
            await onCreateCollection(normalizedName);
            setNewCollectionName("");
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "创建收藏夹失败。");
        } finally {
            setBusy(false);
        }
    };

    /** 下拉只列尚未打到本条 Story 的标签，避免重复添加。 */
    const attachableLabels = (labelOptions ?? []).filter((option) => {
        return !story.labels.some((label) => label.id === option.id);
    });

    return (
        <div
            className="fixed inset-0 z-50 bg-background/70"
            onClick={onClose}
        >
            <div
                aria-labelledby="cosmos-story-title"
                aria-modal="true"
                role="dialog"
                className="absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col rounded-t-[var(--radius-panel)] border bg-card shadow-[var(--elevation-dialog)] sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-full sm:max-w-xl sm:rounded-r-none sm:rounded-bl-[var(--radius-panel)]"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-4 border-b px-6 py-5">
                    <div className="flex min-w-0 flex-col gap-1">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Story 详情</p>
                        <h2
                            id="cosmos-story-title"
                            className="font-display text-2xl font-semibold leading-snug tracking-tight"
                        >
                            {story.story.title}
                        </h2>
                        <p className="text-sm text-muted-foreground">
                            {story.entry.sourceName} · {story.entry.revisions.length} 个 Revision
                        </p>
                    </div>
                    <Button
                        ref={closeButtonRef}
                        variant="ghost"
                        size="sm"
                        onClick={onClose}
                    >
                        <X data-icon="inline-start" />
                        关闭
                    </Button>
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
                    <section aria-label="来源成员" className="border-b pb-4">
                        <h3 className="font-medium">
                            来源成员（{story.entries.length}）
                        </h3>
                        {story.entries.length > 0 && (
                            <ul className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
                                {story.entries.map((member) => (
                                    <li
                                        key={member.id}
                                        data-story-member-id={member.id}
                                        className="truncate"
                                    >
                                        {member.sourceName} ·{" "}
                                        {member.revisions[0]?.title ?? "无标题"} ·{" "}
                                        {member.id}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                    {currentWebUrl && (
                        <a
                            href={currentWebUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex w-fit items-center gap-1.5 rounded-sm text-sm text-primary underline-offset-4 hover:underline focus-visible:border-ring focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none"
                        >
                            <ExternalLink aria-hidden={true} className="size-3.5" />
                            打开原文
                        </a>
                    )}
                    <div className="max-w-prose whitespace-pre-wrap text-sm leading-7">
                        {currentRevision?.contentText ?? "暂无正文"}
                    </div>
                    <RevisionAssets assets={currentRevision?.assets ?? []} />
                    <dl className="grid gap-4 border-t pt-4 text-sm md:grid-cols-2">
                        <div className="min-w-0">
                            <dt className="font-medium">Entry</dt>
                            <dd className="truncate text-muted-foreground">{story.entry.id}</dd>
                        </div>
                        <div className="min-w-0">
                            <dt className="font-medium">Source</dt>
                            <dd className="truncate text-muted-foreground">
                                {story.entry.sourceName} · {story.entry.sourceKind}
                            </dd>
                        </div>
                    </dl>
                    <div className="flex flex-wrap gap-2 pb-2">
                        {story.entry.revisions.map((revision) => (
                            <Badge key={revision.id} variant="secondary">
                                Revision {revision.revision} · {revision.id}
                            </Badge>
                        ))}
                        {story.entry.observations.map((observation) => (
                            <Badge key={observation.id} variant="outline">
                                Observation · {observation.webUrl ?? "无网页 URL"}
                            </Badge>
                        ))}
                    </div>
                    <section
                        aria-label="Story 操作"
                        className="grid gap-4 border-t pt-4"
                    >
                        <form
                            className="flex flex-wrap items-center gap-2"
                            onSubmit={submitRevisionUpdate}
                        >
                            <label
                                htmlFor="cosmos-story-title-edit"
                                className="text-sm font-medium"
                            >
                                标题
                            </label>
                            <Input
                                id="cosmos-story-title-edit"
                                value={title}
                                onChange={(event) => setTitle(event.target.value)}
                                disabled={busy}
                                className="max-w-xs"
                            />
                            <Button type="submit" disabled={busy} variant="outline">
                                更新标题
                            </Button>
                        </form>
                        <form
                            className="flex flex-wrap items-center gap-2"
                            onSubmit={submitMerge}
                        >
                            <label
                                htmlFor="cosmos-story-merge-target"
                                className="text-sm font-medium"
                            >
                                并入本 Story 的 Story ID
                            </label>
                            <Input
                                id="cosmos-story-merge-target"
                                value={mergeStoryId}
                                onChange={(event) => setMergeStoryId(event.target.value)}
                                disabled={busy}
                                placeholder="story:..."
                                className="max-w-xs"
                            />
                            <Button type="submit" disabled={busy} variant="outline">
                                归并
                            </Button>
                        </form>
                        {actionError && (
                            <p
                                role="alert"
                                className="text-sm text-destructive"
                                data-story-action-error="true"
                            >
                                {actionError}
                            </p>
                        )}
                    </section>
                    {(onToggleFavorite
                        || onAttachLabel
                        || onDetachLabel
                        || onCreateLabel
                        || onToggleCollection
                        || onCreateCollection) && (
                        <section
                            aria-label="用户组织"
                            className="grid gap-4 border-t pt-4"
                        >
                            <h3 className="font-medium">用户组织</h3>
                            {onToggleFavorite && (
                                <div className="flex flex-wrap items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={busy}
                                        data-testid="story-favorite-toggle"
                                        onClick={() => void submitToggleFavorite()}
                                    >
                                        {story.favorited ? "★ 取消收藏" : "☆ 收藏"}
                                    </Button>
                                    <span className="text-sm text-muted-foreground">
                                        {story.favorited
                                            ? "已收藏本条 Story，可在收藏列表快速找回。"
                                            : "收藏后可在收藏列表快速找回本条 Story。"}
                                    </span>
                                </div>
                            )}
                            {(onAttachLabel || onDetachLabel || onCreateLabel) && (
                                <div className="grid gap-3">
                                    <h4 className="text-sm font-medium">标签</h4>
                                    {story.labels.length === 0 ? (
                                        <p className="text-sm text-muted-foreground">
                                            本条 Story 还没有标签；可从已有标签添加或新建一个。
                                        </p>
                                    ) : (
                                        <ul className="flex flex-wrap gap-2">
                                            {story.labels.map((label) => (
                                                <li
                                                    key={label.id}
                                                    className="inline-flex items-center gap-1 rounded-[var(--radius-md)] border bg-muted/40 py-0.5 pl-2 pr-1 text-sm"
                                                >
                                                    {label.name}
                                                    {onDetachLabel && (
                                                        <button
                                                            type="button"
                                                            data-testid={`story-label-${label.id}`}
                                                            aria-label={`移除标签 ${label.name}`}
                                                            disabled={busy}
                                                            onClick={() => void submitDetachLabel(label.id)}
                                                            className="flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none disabled:opacity-50"
                                                        >
                                                            <X aria-hidden={true} className="size-3" />
                                                        </button>
                                                    )}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                    {onAttachLabel && attachableLabels.length > 0 && (
                                        <div className="flex flex-wrap items-center gap-2">
                                            <select
                                                aria-label="选择要添加的标签"
                                                value={attachLabelId}
                                                disabled={busy}
                                                className="rounded-sm border bg-card px-2 py-1 text-sm"
                                                onChange={(event) => setAttachLabelId(event.target.value)}
                                            >
                                                <option value="">选择标签…</option>
                                                {attachableLabels.map((option) => (
                                                    <option key={option.id} value={option.id}>
                                                        {option.name}
                                                    </option>
                                                ))}
                                            </select>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                disabled={busy || !attachLabelId}
                                                onClick={() => void submitAttachLabel()}
                                            >
                                                添加
                                            </Button>
                                        </div>
                                    )}
                                    {onCreateLabel && (
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Input
                                                id="cosmos-story-new-label-name"
                                                value={newLabelName}
                                                onChange={(event) => setNewLabelName(event.target.value)}
                                                disabled={busy}
                                                placeholder="新标签名称"
                                                className="max-w-52"
                                            />
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                disabled={busy || !newLabelName.trim()}
                                                onClick={() => void submitCreateLabel()}
                                            >
                                                创建并添加
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            )}
                            {(onToggleCollection || onCreateCollection) && (
                                <div className="grid gap-3">
                                    <h4 className="text-sm font-medium">收藏夹</h4>
                                    {onToggleCollection && (
                                        collections && collections.length > 0
                                            ? (
                                                <ul className="grid gap-2">
                                                    {collections.map((collection) => {
                                                        const member = collection.containsStory === true;
                                                        return (
                                                            <li key={collection.id}>
                                                                <label className="flex items-center gap-2 text-sm">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={member}
                                                                        disabled={busy}
                                                                        data-testid={`story-collection-${collection.id}`}
                                                                        onChange={() => void submitToggleCollection(collection.id, member)}
                                                                        className="size-4 rounded-sm border"
                                                                    />
                                                                    <span className="min-w-0 flex-1 truncate">
                                                                        {collection.name}
                                                                    </span>
                                                                </label>
                                                            </li>
                                                        );
                                                    })}
                                                </ul>
                                            )
                                            : (
                                                <p className="text-sm text-muted-foreground">
                                                    还没有收藏夹；可新建一个后把本条 Story 收纳进去。
                                                </p>
                                            )
                                    )}
                                    {onCreateCollection && (
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Input
                                                id="cosmos-story-new-collection-name"
                                                value={newCollectionName}
                                                onChange={(event) => setNewCollectionName(event.target.value)}
                                                disabled={busy}
                                                placeholder="新收藏夹名称"
                                                className="max-w-52"
                                            />
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                disabled={busy || !newCollectionName.trim()}
                                                onClick={() => void submitCreateCollection()}
                                            >
                                                新建收藏夹
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </section>
                    )}
                    {story.entities.length > 0 && (
                        <section
                            aria-label="关联实体"
                            className="grid gap-3 border-t pt-4"
                        >
                            <h3 className="font-medium">
                                关联实体（{story.entities.length}）
                            </h3>
                            <ul>
                                {story.entities.map((link) => (
                                    <EntityRow
                                        key={link.entityId}
                                        link={link}
                                        busy={busy}
                                        onUnlink={submitUnlinkEntity}
                                    />
                                ))}
                            </ul>
                        </section>
                    )}
                    {entityOptions && entityOptions.length > 0 && (
                        <section
                            aria-label="关联 Entity"
                            className="grid gap-3 border-t pt-4"
                        >
                            <h3 className="font-medium">关联已有 Entity</h3>
                            <div className="flex flex-wrap items-center gap-2">
                                <select
                                    aria-label="选择 Entity"
                                    value={linkEntityId}
                                    disabled={busy}
                                    className="rounded-sm border bg-card px-2 py-1 text-sm"
                                    onChange={(event) => setLinkEntityId(event.target.value)}
                                >
                                    <option value="">选择 Entity…</option>
                                    {entityOptions.map((item) => (
                                        <option
                                            key={item.id}
                                            value={item.id}
                                            disabled={story.entities.some((link) => {
                                                return link.entityId === item.id;
                                            })}
                                        >
                                            {item.name}
                                        </option>
                                    ))}
                                </select>
                                <Button
                                    variant="outline"
                                    disabled={busy || !linkEntityId}
                                    onClick={() => void submitLinkEntity()}
                                >
                                    关联
                                </Button>
                            </div>
                        </section>
                    )}
                    {onCreateEntityLinked && (
                        <section
                            aria-label="创建 Entity"
                            className="grid gap-3 border-t pt-4"
                        >
                            <h3 className="font-medium">创建 Entity 并关联本 Story</h3>
                            <Input
                                id="cosmos-new-entity-name"
                                value={newEntityName}
                                onChange={(event) => setNewEntityName(event.target.value)}
                                disabled={busy}
                                placeholder="Entity 名称，例如 Jeff Dean"
                            />
                            <select
                                aria-label="Entity 类型"
                                value={newEntityType}
                                disabled={busy}
                                className="w-fit rounded-sm border bg-card px-2 py-1 text-sm"
                                onChange={(event) => setNewEntityType(event.target.value)}
                            >
                                {ENTITY_TYPE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                            <Button
                                variant="outline"
                                className="w-fit"
                                disabled={busy || !newEntityName.trim()}
                                onClick={() => void submitCreateEntity()}
                            >
                                创建并关联
                            </Button>
                        </section>
                    )}
                    {topics && topics.length > 0 && (
                        <section
                            aria-label="加入 Topic"
                            className="grid gap-3 border-t pt-4"
                        >
                            <h3 className="font-medium">加入 Topic</h3>
                            <div className="flex flex-wrap items-center gap-2">
                                <select
                                    aria-label="选择 Topic"
                                    value={joinTopicId}
                                    disabled={busy}
                                    className="rounded-sm border bg-card px-2 py-1 text-sm"
                                    onChange={(event) => setJoinTopicId(event.target.value)}
                                >
                                    <option value="">选择 Topic…</option>
                                    {topics.map((item) => (
                                        <option key={item.id} value={item.id}>
                                            {item.title}
                                        </option>
                                    ))}
                                </select>
                                <select
                                    aria-label="加入角色"
                                    value={joinRole}
                                    disabled={busy}
                                    className="rounded-sm border bg-card px-2 py-1 text-sm"
                                    onChange={(event) => {
                                        setJoinRole(event.target.value as TopicMemberRole);
                                    }}
                                >
                                    {ROLE_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                                <Button
                                    variant="outline"
                                    disabled={busy || !joinTopicId}
                                    onClick={() => void submitJoinTopic()}
                                >
                                    加入
                                </Button>
                            </div>
                        </section>
                    )}
                    {onCreateTopic && (
                        <section
                            aria-label="创建 Topic"
                            className="grid gap-3 border-t pt-4"
                        >
                            <h3 className="font-medium">创建 Topic 并加入本 Story</h3>
                            <Input
                                id="cosmos-new-topic-title"
                                value={newTopicTitle}
                                onChange={(event) => setNewTopicTitle(event.target.value)}
                                disabled={busy}
                                placeholder="Topic 标题"
                            />
                            <Input
                                id="cosmos-new-topic-purpose"
                                value={newTopicPurpose}
                                onChange={(event) => setNewTopicPurpose(event.target.value)}
                                disabled={busy}
                                placeholder="关注目的"
                            />
                            <Button
                                variant="outline"
                                className="w-fit"
                                disabled={busy || !newTopicTitle.trim() || !newTopicPurpose.trim()}
                                onClick={() => void submitCreateTopic()}
                            >
                                创建并加入
                            </Button>
                        </section>
                    )}
                </div>
            </div>
        </div>
    );
}
