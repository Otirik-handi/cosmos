import { ExternalLink, Image as ImageIcon, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEventHandler } from "react";

import type {
    Annotation,
    AssetSnapshot,
    CollectionSummary,
    EntitySummary,
    EntryListItem,
    EntryStoryRelationType,
    LabelRef,
    SplitStoryCommand,
    StoryDetail,
    StoryEntitySummary,
    StorySubtype,
    TopicMemberRole,
    TopicSummary,
    UpdateStoryRevisionCommand,
} from "@cosmos/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ROLE_OPTIONS } from "@/components/cosmos/topic-panel";
import {
    ENTITY_TYPE_OPTIONS,
    entityTypeLabel,
} from "@/components/cosmos/entity-panel";
import { buildStoryTimeline, type StoryTimelineEvent } from "@/lib/story-timeline";
import type { RelatedStory } from "@/lib/related-stories";

type StoryPanelProps = {
    onClose: () => void;
    story: StoryDetail;
    onUpdateStoryRevision: (command: UpdateStoryRevisionCommand) => Promise<void>;
    onMergeStory: (obsoleteStoryId: string) => Promise<void>;
    /** 受管理 subtype 目录（ORG-013）；读取失败时下拉只有「无 subtype」。 */
    subtypeOptions?: readonly StorySubtype[];
    /** 拆分 Story（ADR-0012）：一次提交全部后继与显式关系映射。 */
    onSplitStory?: (command: SplitStoryCommand) => Promise<void>;
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
    annotations?: readonly Annotation[];
    onCreateAnnotation?: (input: { body: string; quote?: string | null }) => Promise<void>;
    onUpdateAnnotation?: (
        annotationId: string,
        input: { body: string; quote?: string | null },
    ) => Promise<void>;
    onDeleteAnnotation?: (annotationId: string) => Promise<void>;
    /** 固定到当前看板的 Spotlight 区块（ADR-0010 人工固定）。 */
    onPinToBoard?: () => Promise<void>;
    /** 相关内容 v1（REC-008）：共享分类或共享实体的其它 Story，不是同一 Story。 */
    relatedStories?: readonly RelatedStory[];
    onOpenRelatedStory?: (storyId: string) => Promise<void>;
    /** 证据关系候选条目（来自 GET /entries）；页面已排除本 Story 的成员。 */
    entryOptions?: readonly Pick<EntryListItem, "id" | "title" | "sourceName">[];
    onLinkEntry?: (input: { entryId: string; relationType: EntryStoryRelationType }) => Promise<void>;
    onUnlinkEntry?: (entryId: string) => Promise<void>;
};

const RELATION_TYPE_LABELS: Record<string, string> = {
    evidence_for: "证据",
    mentions: "提及",
};

function relationTypeLabel(type: string): string {
    return RELATION_TYPE_LABELS[type] ?? type;
}

function formatTimelineDate(value: string | null): string {
    if (!value) {
        return "时间未知";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "时间未知";
    }
    const pad = (part: number): string => part.toString().padStart(2, "0");
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function TimelineSection({ events }: { events: readonly StoryTimelineEvent[] }) {
    return (
        <section aria-label="时间线" className="border-b pb-4">
            <h3 className="font-medium">时间线（{events.length}）</h3>
            {events.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                    本条 Story 还没有可展示的来源事件。
                </p>
            ) : (
                <ol className="mt-3 flex flex-col gap-3" data-story-timeline="true">
                    {events.map((event) => (
                        <li key={event.id} className="flex flex-col gap-1 border-l-2 pl-3">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                                <span>{formatTimelineDate(event.at)}</span>
                                <Badge variant="secondary">{event.kind}</Badge>
                                <span>{event.sourceName}</span>
                                {event.detail && <span>· {event.detail}</span>}
                            </div>
                            <p className="truncate text-sm">{event.title}</p>
                        </li>
                    ))}
                </ol>
            )}
        </section>
    );
}

function SplitTargetSelect({
    label,
    value,
    successors,
    disabled,
    onChange,
}: {
    label: string;
    value: number;
    successors: readonly { title: string }[];
    disabled: boolean;
    onChange: (next: number) => void;
}) {
    return (
        <label className="flex flex-col gap-1 text-sm">
            <span className="truncate text-muted-foreground">{label}</span>
            <select
                aria-label={`${label} 的拆分去向`}
                value={value}
                disabled={disabled}
                className="rounded-sm border bg-card px-2 py-1 text-sm"
                onChange={(event) => onChange(Number(event.target.value))}
            >
                <option value={-1}>留在历史壳</option>
                {successors.map((successor, index) => (
                    <option key={index} value={index}>
                        {successor.title.trim() || `后继 ${index + 1}`}
                    </option>
                ))}
            </select>
        </label>
    );
}

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

const STORY_KIND_LABELS: Record<string, string> = {
    event: "事件",
    document: "文档",
    media: "媒体",
    thread: "讨论串",
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
                        {asset.status !== "metadata_only"
                            && (asset.attemptCount ?? 0) > 0 && (
                            <span className="text-xs text-muted-foreground">
                                已尝试 {asset.attemptCount} 次
                            </span>
                        )}
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

/** 目录里属于该 kind 的注册项才可用于新写入（ORG-013）。 */
function registeredStorySubtype(
    options: readonly StorySubtype[],
    subtype: string | null,
    kind: StoryDetail["story"]["kind"],
): string | null {
    if (subtype === null) {
        return null;
    }
    return options.some((option) => option.id === subtype && option.kind === kind)
        ? subtype
        : null;
}

function StorySubtypeSelect({
    id,
    label,
    value,
    kind,
    options,
    disabled,
    onChange,
}: {
    id: string;
    label: string;
    value: string | null;
    kind: StoryDetail["story"]["kind"];
    options: readonly StorySubtype[];
    disabled: boolean;
    onChange: (value: string | null) => void;
}) {
    const forKind = options.filter((option) => option.kind === kind);
    // 旧数据可能是未注册值；原样保留而不是替用户丢掉。
    const showLegacy = value !== null && !forKind.some((option) => option.id === value);
    return (
        <select
            id={id}
            aria-label={label}
            value={value ?? ""}
            disabled={disabled}
            className="rounded-sm border bg-card px-2 py-1 text-sm"
            onChange={(event) => {
                onChange(event.target.value === "" ? null : event.target.value);
            }}
        >
            <option value="">无 subtype</option>
            {showLegacy && <option value={value}>{value}（未注册）</option>}
            {forKind.map((option) => (
                <option key={option.id} value={option.id}>
                    {option.label}（{option.id}）{option.status === "deprecated" ? " · 已弃用" : ""}
                </option>
            ))}
        </select>
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
    onSplitStory,
    subtypeOptions = [],
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
    annotations,
    onCreateAnnotation,
    onUpdateAnnotation,
    onDeleteAnnotation,
    onPinToBoard,
    relatedStories = [],
    onOpenRelatedStory,
    entryOptions = [],
    onLinkEntry,
    onUnlinkEntry,
}: StoryPanelProps) {
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const onCloseRef = useRef(onClose);
    const [title, setTitle] = useState(story.story.title);
    const [kind, setKind] = useState<StoryDetail["story"]["kind"]>(story.story.kind);
    // A subtype already stored on the Story may be unregistered legacy data;
    // keeping it unchanged is allowed, so it must stay selectable.
    const [subtype, setSubtype] = useState<string | null>(story.story.subtype);
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
    const [newAnnotationBody, setNewAnnotationBody] = useState("");
    const [newAnnotationQuote, setNewAnnotationQuote] = useState("");
    const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);
    const [editingAnnotationBody, setEditingAnnotationBody] = useState("");
    const [editingAnnotationQuote, setEditingAnnotationQuote] = useState("");
    const [linkEntryId, setLinkEntryId] = useState("");
    const [linkRelationType, setLinkRelationType] = useState<EntryStoryRelationType>("evidence_for");
    const [splitSuccessors, setSplitSuccessors] = useState<Array<{
        title: string;
        kind: StoryDetail["story"]["kind"];
        subtype: string | null;
    }>>([
        { title: `${story.story.title}（1）`, kind: story.story.kind, subtype: registeredStorySubtype(subtypeOptions, story.story.subtype, story.story.kind) },
        { title: `${story.story.title}（2）`, kind: story.story.kind, subtype: registeredStorySubtype(subtypeOptions, story.story.subtype, story.story.kind) },
    ]);
    const [splitEntryTargets, setSplitEntryTargets] = useState<Record<string, number>>({});
    const [splitEvidenceTargets, setSplitEvidenceTargets] = useState<Record<string, number>>({});
    const [splitEntityTargets, setSplitEntityTargets] = useState<Record<string, number>>({});
    const [splitTopicTargets, setSplitTopicTargets] = useState<Record<string, number>>({});

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

    const currentRevision = story.entry?.revisions[0];
    const currentWebUrl = currentRevision?.webUrl ?? null;
    const timeline = buildStoryTimeline(story);
    const isShell = story.story.status === "split";
    const storySubtypeLabel = story.story.subtype === null
        ? null
        : subtypeOptions.find((option) => (
            option.id === story.story.subtype && option.kind === story.story.kind
        ))?.label ?? `${story.story.subtype}（未注册）`;
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
                kind,
                subtype,
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

    const updateSplitSuccessor = (
        index: number,
        patch: Partial<{ title: string; kind: StoryDetail["story"]["kind"]; subtype: string | null }>,
    ): void => {
        setSplitSuccessors((current) => current.map((successor, position) => {
            if (position !== index) {
                return successor;
            }
            const next = { ...successor, ...patch };
            // A subtype registered for the old kind is not writable on the new
            // kind; clear it instead of letting the server reject the split.
            if (patch.kind !== undefined && patch.kind !== successor.kind) {
                next.subtype = registeredStorySubtype(subtypeOptions, next.subtype, next.kind);
            }
            return next;
        }));
    };
    const addSplitSuccessor = (): void => {
        setSplitSuccessors((current) => (current.length >= 5 ? current : [
            ...current,
            {
                title: `${story.story.title}（${current.length + 1}）`,
                kind: story.story.kind,
                subtype: registeredStorySubtype(subtypeOptions, story.story.subtype, story.story.kind),
            },
        ]));
    };
    const submitSplit: FormEventHandler = async (event) => {
        event.preventDefault();
        if (!onSplitStory) {
            return;
        }
        const titles = splitSuccessors.map((successor) => successor.title.trim());
        if (titles.some((value) => value.length === 0)) {
            setActionError("每个后继都需要标题。");
            return;
        }
        const successors = splitSuccessors.map((successor, index) => ({
            title: successor.title.trim(),
            summary: null,
            kind: successor.kind,
            subtype: successor.subtype,
            entryIds: story.entries
                .filter((member) => (splitEntryTargets[member.id] ?? -1) === index)
                .map((member) => member.id),
            evidenceEntryIds: story.evidence
                .filter((item) => (splitEvidenceTargets[item.entryId] ?? -1) === index)
                .map((item) => item.entryId),
            entityIds: story.entities
                .filter((item) => (splitEntityTargets[item.entityId] ?? -1) === index)
                .map((item) => item.entityId),
            topicIds: story.topics
                .filter((item) => (splitTopicTargets[item.topicId] ?? -1) === index)
                .map((item) => item.topicId),
        }));
        const emptyIndex = successors.findIndex((successor) => successor.entryIds.length === 0);
        if (emptyIndex >= 0) {
            setActionError(
                `后继「${titles[emptyIndex]}」还没有分配到任何成员；请给它至少一个成员，或减少后继数量。`,
            );
            return;
        }
        setBusy(true);
        setActionError(null);
        try {
            await onSplitStory({ successors });
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "拆分 Story 失败。");
        } finally {
            setBusy(false);
        }
    };

    const submitLinkEntry = async (): Promise<void> => {
        if (!onLinkEntry || !linkEntryId) {
            return;
        }
        setBusy(true);
        setActionError(null);
        try {
            await onLinkEntry({ entryId: linkEntryId, relationType: linkRelationType });
            setLinkEntryId("");
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "添加证据来源失败。");
        } finally {
            setBusy(false);
        }
    };

    const submitUnlinkEntry = async (entryId: string): Promise<void> => {
        if (!onUnlinkEntry) {
            return;
        }
        setBusy(true);
        setActionError(null);
        try {
            await onUnlinkEntry(entryId);
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "解除证据来源失败。");
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

    const submitPinToBoard = async (): Promise<void> => {
        if (!onPinToBoard) {
            return;
        }
        setBusy(true);
        setActionError(null);
        try {
            await onPinToBoard();
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "固定到看板失败。");
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

    const submitCreateAnnotation = async (): Promise<void> => {
        if (!onCreateAnnotation) {
            return;
        }
        const normalizedBody = newAnnotationBody.trim();
        if (!normalizedBody) {
            return;
        }
        const normalizedQuote = newAnnotationQuote.trim();
        setBusy(true);
        setActionError(null);
        try {
            await onCreateAnnotation({
                body: normalizedBody,
                quote: normalizedQuote || null,
            });
            setNewAnnotationBody("");
            setNewAnnotationQuote("");
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "添加批注失败。");
        } finally {
            setBusy(false);
        }
    };

    const startEditAnnotation = (annotation: Annotation): void => {
        setEditingAnnotationId(annotation.id);
        setEditingAnnotationBody(annotation.body);
        setEditingAnnotationQuote(annotation.quote ?? "");
    };

    const cancelEditAnnotation = (): void => {
        setEditingAnnotationId(null);
        setEditingAnnotationBody("");
        setEditingAnnotationQuote("");
    };

    const submitUpdateAnnotation = async (annotationId: string): Promise<void> => {
        if (!onUpdateAnnotation) {
            return;
        }
        const normalizedBody = editingAnnotationBody.trim();
        if (!normalizedBody) {
            return;
        }
        const normalizedQuote = editingAnnotationQuote.trim();
        setBusy(true);
        setActionError(null);
        try {
            await onUpdateAnnotation(annotationId, {
                body: normalizedBody,
                quote: normalizedQuote || null,
            });
            cancelEditAnnotation();
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "更新批注失败。");
        } finally {
            setBusy(false);
        }
    };

    const submitDeleteAnnotation = async (annotationId: string): Promise<void> => {
        if (!onDeleteAnnotation) {
            return;
        }
        setBusy(true);
        setActionError(null);
        try {
            await onDeleteAnnotation(annotationId);
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "删除批注失败。");
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
                data-story-id={story.story.id}
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
                        <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="secondary">
                                {STORY_KIND_LABELS[story.story.kind] ?? story.story.kind}
                            </Badge>
                            {storySubtypeLabel !== null && (
                                <Badge
                                    variant="outline"
                                    data-story-subtype={story.story.subtype ?? undefined}
                                >
                                    {storySubtypeLabel}
                                </Badge>
                            )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                            {story.entry
                                ? `${story.entry.sourceName} · ${story.entry.revisions.length} 个 Revision`
                                : "历史壳：成员已全部拆分到后继 Story"}
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
                                        className="flex flex-col"
                                    >
                                        <span className="truncate">
                                            {member.sourceName} ·{" "}
                                            {member.revisions[0]?.title ?? "无标题"} ·{" "}
                                            {member.id}
                                        </span>
                                        {member.relatedStories.length > 0 && (
                                            <span
                                                className="truncate text-xs"
                                                data-story-member-links={member.id}
                                            >
                                                作为{member.relatedStories
                                                    .map((related) => relationTypeLabel(related.relationType))
                                                    .join("、")}
                                                关联到：
                                                {member.relatedStories
                                                    .map((related) => related.title)
                                                    .join("、")}
                                            </span>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                    {isShell && (
                        <section
                            aria-label="历史壳"
                            className="border-b pb-4"
                            data-story-shell="true"
                        >
                            <h3 className="font-medium">
                                历史壳（后继 {story.story.replacedBy.length}）
                            </h3>
                            <p className="mt-2 text-sm text-muted-foreground">
                                本条 Story 已被拆分；它的成员历史、批注与审计仍然保留在这里，但不再接受归并、改标题或再次拆分。
                            </p>
                            <ul className="mt-2 grid gap-2">
                                {story.story.replacedBy.map((successor) => (
                                    <li
                                        key={successor.storyId}
                                        className="flex flex-col gap-0.5 rounded-sm border bg-muted/40 px-3 py-2"
                                    >
                                        <button
                                            type="button"
                                            disabled={!onOpenRelatedStory || busy}
                                            onClick={() => {
                                                if (onOpenRelatedStory) {
                                                    void onOpenRelatedStory(successor.storyId);
                                                }
                                            }}
                                            className="rounded-sm text-left text-sm hover:text-primary focus-visible:border-ring focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none disabled:opacity-60"
                                            data-story-successor-id={successor.storyId}
                                        >
                                            {successor.title}
                                        </button>
                                        <span className="text-xs text-muted-foreground">
                                            {successor.kind} · {successor.storyId}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}
                    <section aria-label="证据来源" className="border-b pb-4">
                        <h3 className="font-medium">证据来源（{story.evidence.length}）</h3>
                        {story.evidence.length === 0 ? (
                            <p className="mt-2 text-sm text-muted-foreground">
                                还没有其它 Story 引用本 Story 的条目；可在下方添加一条证据或提及。
                            </p>
                        ) : (
                            <ul className="mt-2 grid gap-2" data-story-evidence="true">
                                {story.evidence.map((item) => (
                                    <li
                                        key={item.entryId}
                                        data-story-evidence-entry-id={item.entryId}
                                        className="flex flex-col gap-1 rounded-sm border bg-muted/40 px-3 py-2"
                                    >
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                                            <Badge variant="secondary">
                                                {relationTypeLabel(item.relationType)}
                                            </Badge>
                                            <span>{item.sourceName}</span>
                                            {item.reason && <span>· {item.reason}</span>}
                                        </div>
                                        <span className="truncate text-sm">
                                            {item.title ?? item.entryId}
                                        </span>
                                        <span className="truncate text-xs text-muted-foreground">
                                            {item.entryId}
                                        </span>
                                        {onUnlinkEntry && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="w-fit"
                                                disabled={busy}
                                                onClick={() => void submitUnlinkEntry(item.entryId)}
                                            >
                                                解除
                                            </Button>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                        {onLinkEntry && (
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                                <select
                                    aria-label="选择证据条目"
                                    value={linkEntryId}
                                    disabled={busy}
                                    className="max-w-xs rounded-sm border bg-card px-2 py-1 text-sm"
                                    onChange={(event) => setLinkEntryId(event.target.value)}
                                >
                                    <option value="">选择条目…</option>
                                    {entryOptions.map((option) => (
                                        <option key={option.id} value={option.id}>
                                            {option.sourceName} · {option.title}
                                        </option>
                                    ))}
                                </select>
                                <select
                                    aria-label="证据关系类型"
                                    value={linkRelationType}
                                    disabled={busy}
                                    className="rounded-sm border bg-card px-2 py-1 text-sm"
                                    onChange={(event) => {
                                        setLinkRelationType(event.target.value as EntryStoryRelationType);
                                    }}
                                >
                                    <option value="evidence_for">证据</option>
                                    <option value="mentions">提及</option>
                                </select>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={busy || !linkEntryId}
                                    onClick={() => void submitLinkEntry()}
                                >
                                    添加
                                </Button>
                            </div>
                        )}
                    </section>
                    <TimelineSection events={timeline} />
                    <section aria-label="相关内容" className="border-b pb-4">
                        <h3 className="font-medium">相关内容（{relatedStories.length}）</h3>
                        {relatedStories.length === 0 ? (
                            <p className="mt-2 text-sm text-muted-foreground">
                                暂无相关但不同事件的 Story；给本条 Story 添加分类或关联 Entity 后会自动出现。
                            </p>
                        ) : (
                            <ul className="mt-2 grid gap-2" data-story-related="true">
                                {relatedStories.map((item) => (
                                    <li
                                        key={item.storyId}
                                        className="flex flex-col gap-0.5 rounded-sm border bg-muted/40 px-3 py-2"
                                    >
                                        <button
                                            type="button"
                                            disabled={!onOpenRelatedStory || busy}
                                            onClick={() => {
                                                if (onOpenRelatedStory) {
                                                    void onOpenRelatedStory(item.storyId);
                                                }
                                            }}
                                            className="rounded-sm text-left text-sm hover:text-primary focus-visible:border-ring focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none disabled:opacity-60"
                                        >
                                            {item.title}
                                        </button>
                                        <span className="text-xs text-muted-foreground">
                                            {item.reason} · {item.storyId}
                                        </span>
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
                    {story.entry && (
                        <>
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
                        </>
                    )}
                    {!isShell && (
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
                                <label
                                    htmlFor="cosmos-story-kind-edit"
                                    className="text-sm font-medium"
                                >
                                    类型
                                </label>
                                <select
                                    id="cosmos-story-kind-edit"
                                    aria-label="Story 类型"
                                    value={kind}
                                    disabled={busy}
                                    className="rounded-sm border bg-card px-2 py-1 text-sm"
                                    onChange={(event) => {
                                        const nextKind = event.target.value as StoryDetail["story"]["kind"];
                                        setKind(nextKind);
                                        // A subtype registered for the old kind is
                                        // not writable on the new kind.
                                        setSubtype((current) => registeredStorySubtype(
                                            subtypeOptions,
                                            current,
                                            nextKind,
                                        ));
                                    }}
                                >
                                    <option value="event">事件</option>
                                    <option value="document">文档</option>
                                    <option value="media">媒体</option>
                                    <option value="thread">讨论串</option>
                                </select>
                                <label
                                    htmlFor="cosmos-story-subtype-edit"
                                    className="text-sm font-medium"
                                >
                                    subtype
                                </label>
                                <StorySubtypeSelect
                                    id="cosmos-story-subtype-edit"
                                    label="Story subtype"
                                    value={subtype}
                                    kind={kind}
                                    options={subtypeOptions}
                                    disabled={busy}
                                    onChange={setSubtype}
                                />
                                <Button type="submit" disabled={busy} variant="outline">
                                    保存修改
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
                        </section>
                    )}
                    {!isShell && onSplitStory && story.entries.length >= 2 && (
                        <form
                            aria-label="拆分 Story"
                            className="grid gap-3 border-t pt-4"
                            onSubmit={submitSplit}
                        >
                            <h3 className="font-medium">拆分 Story</h3>
                            <p className="text-sm text-muted-foreground">
                                把本条 Story 拆成多个后继；没有指定去向的成员、证据、实体与 Topic 会留在本条历史壳上。
                            </p>
                            <div className="grid gap-2">
                                {splitSuccessors.map((successor, index) => (
                                    <div
                                        key={index}
                                        className="flex flex-wrap items-center gap-2"
                                    >
                                        <label
                                            htmlFor={`cosmos-split-title-${index}`}
                                            className="text-sm font-medium"
                                        >
                                            后继 {index + 1}
                                        </label>
                                        <Input
                                            id={`cosmos-split-title-${index}`}
                                            value={successor.title}
                                            onChange={(event) => {
                                                updateSplitSuccessor(index, { title: event.target.value });
                                            }}
                                            disabled={busy}
                                            className="max-w-xs"
                                        />
                                        <select
                                            aria-label={`后继 ${index + 1} 类型`}
                                            value={successor.kind}
                                            disabled={busy}
                                            className="rounded-sm border bg-card px-2 py-1 text-sm"
                                            onChange={(event) => {
                                                updateSplitSuccessor(index, {
                                                    kind: event.target.value as StoryDetail["story"]["kind"],
                                                });
                                            }}
                                        >
                                            <option value="event">event</option>
                                            <option value="document">document</option>
                                            <option value="media">media</option>
                                            <option value="thread">thread</option>
                                        </select>
                                        <StorySubtypeSelect
                                            id={`cosmos-split-subtype-${index}`}
                                            label={`后继 ${index + 1} subtype`}
                                            value={successor.subtype}
                                            kind={successor.kind}
                                            options={subtypeOptions}
                                            disabled={busy}
                                            onChange={(value) => {
                                                updateSplitSuccessor(index, { subtype: value });
                                            }}
                                        />
                                    </div>
                                ))}
                                {splitSuccessors.length < 5 && (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="w-fit"
                                        disabled={busy}
                                        onClick={addSplitSuccessor}
                                    >
                                        增加后继
                                    </Button>
                                )}
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2">
                                {story.entries.map((member) => (
                                    <SplitTargetSelect
                                        key={member.id}
                                        label={`成员 ${member.sourceName} · ${member.revisions[0]?.title ?? member.id}`}
                                        value={splitEntryTargets[member.id] ?? -1}
                                        successors={splitSuccessors}
                                        disabled={busy}
                                        onChange={(next) => {
                                            setSplitEntryTargets((current) => ({ ...current, [member.id]: next }));
                                        }}
                                    />
                                ))}
                                {story.evidence.map((item) => (
                                    <SplitTargetSelect
                                        key={item.entryId}
                                        label={`证据 ${item.title ?? item.entryId}`}
                                        value={splitEvidenceTargets[item.entryId] ?? -1}
                                        successors={splitSuccessors}
                                        disabled={busy}
                                        onChange={(next) => {
                                            setSplitEvidenceTargets((current) => ({ ...current, [item.entryId]: next }));
                                        }}
                                    />
                                ))}
                                {story.entities.map((item) => (
                                    <SplitTargetSelect
                                        key={item.entityId}
                                        label={`实体 ${item.name}`}
                                        value={splitEntityTargets[item.entityId] ?? -1}
                                        successors={splitSuccessors}
                                        disabled={busy}
                                        onChange={(next) => {
                                            setSplitEntityTargets((current) => ({ ...current, [item.entityId]: next }));
                                        }}
                                    />
                                ))}
                                {story.topics.map((item) => (
                                    <SplitTargetSelect
                                        key={item.topicId}
                                        label={`Topic ${item.title}`}
                                        value={splitTopicTargets[item.topicId] ?? -1}
                                        successors={splitSuccessors}
                                        disabled={busy}
                                        onChange={(next) => {
                                            setSplitTopicTargets((current) => ({ ...current, [item.topicId]: next }));
                                        }}
                                    />
                                ))}
                            </div>
                            <Button
                                type="submit"
                                disabled={busy}
                                variant="outline"
                                className="w-fit"
                                data-testid="story-split-submit"
                            >
                                拆分
                            </Button>
                        </form>
                    )}
                    {actionError && (
                        <p
                            role="alert"
                            className="text-sm text-destructive"
                            data-story-action-error="true"
                        >
                            {actionError}
                        </p>
                    )}
                    {(onToggleFavorite
                        || onAttachLabel
                        || onDetachLabel
                        || onCreateLabel
                        || onToggleCollection
                        || onCreateCollection
                        || onCreateAnnotation
                        || onUpdateAnnotation
                        || onDeleteAnnotation
                        || onPinToBoard) && (
                        <section
                            aria-label="用户组织"
                            className="grid gap-4 border-t pt-4"
                        >
                            <h3 className="font-medium">用户组织</h3>
                            {onPinToBoard && (
                                <div className="flex flex-wrap items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={busy}
                                        data-testid="story-pin-to-board"
                                        onClick={() => void submitPinToBoard()}
                                    >
                                        固定到看板热点区
                                    </Button>
                                    <span className="text-sm text-muted-foreground">
                                        在当前看板的 Spotlight 区块展示本条 Story。
                                    </span>
                                </div>
                            )}
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
                            {(onCreateAnnotation
                                || onUpdateAnnotation
                                || onDeleteAnnotation) && (
                                <div className="grid gap-3">
                                    <h4 className="text-sm font-medium">批注</h4>
                                    {annotations && annotations.length > 0 ? (
                                        <ul className="grid gap-3">
                                            {annotations.map((annotation) => (
                                                <li
                                                    key={annotation.id}
                                                    data-story-annotation-id={annotation.id}
                                                    className="grid gap-2 rounded-sm border bg-muted/40 p-3 text-sm"
                                                >
                                                    {editingAnnotationId === annotation.id ? (
                                                        <div className="grid gap-2">
                                                            <Textarea
                                                                aria-label="批注正文"
                                                                value={editingAnnotationBody}
                                                                onChange={(event) => setEditingAnnotationBody(event.target.value)}
                                                                disabled={busy}
                                                            />
                                                            <Input
                                                                aria-label="批注引文"
                                                                value={editingAnnotationQuote}
                                                                onChange={(event) => setEditingAnnotationQuote(event.target.value)}
                                                                disabled={busy}
                                                                placeholder="引文（可选）"
                                                            />
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <Button
                                                                    variant="outline"
                                                                    size="sm"
                                                                    disabled={busy || !editingAnnotationBody.trim()}
                                                                    onClick={() => void submitUpdateAnnotation(annotation.id)}
                                                                >
                                                                    保存
                                                                </Button>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    disabled={busy}
                                                                    onClick={cancelEditAnnotation}
                                                                >
                                                                    取消
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <p className="whitespace-pre-wrap leading-6">
                                                                {annotation.body}
                                                            </p>
                                                            {annotation.quote && (
                                                                <p className="border-l-2 pl-2 text-xs text-muted-foreground">
                                                                    {annotation.quote}
                                                                </p>
                                                            )}
                                                            <p className="text-xs text-muted-foreground">
                                                                {annotation.actor ?? "未署名"} ·{" "}
                                                                {new Date(annotation.createdAt).toLocaleString()}
                                                            </p>
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                {onUpdateAnnotation && (
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="sm"
                                                                        disabled={busy}
                                                                        onClick={() => startEditAnnotation(annotation)}
                                                                    >
                                                                        编辑
                                                                    </Button>
                                                                )}
                                                                {onDeleteAnnotation && (
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="sm"
                                                                        disabled={busy}
                                                                        onClick={() => void submitDeleteAnnotation(annotation.id)}
                                                                    >
                                                                        删除
                                                                    </Button>
                                                                )}
                                                            </div>
                                                        </>
                                                    )}
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <p className="text-sm text-muted-foreground">
                                            本条 Story 还没有批注；可在下方记录摘录与想法。
                                        </p>
                                    )}
                                    {onCreateAnnotation && (
                                        <div className="grid gap-2">
                                            <Textarea
                                                aria-label="新批注正文"
                                                value={newAnnotationBody}
                                                onChange={(event) => setNewAnnotationBody(event.target.value)}
                                                disabled={busy}
                                                placeholder="写下批注正文"
                                            />
                                            <Input
                                                aria-label="新批注引文"
                                                value={newAnnotationQuote}
                                                onChange={(event) => setNewAnnotationQuote(event.target.value)}
                                                disabled={busy}
                                                placeholder="引文（可选）"
                                            />
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="w-fit"
                                                disabled={busy || !newAnnotationBody.trim()}
                                                onClick={() => void submitCreateAnnotation()}
                                            >
                                                添加批注
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
