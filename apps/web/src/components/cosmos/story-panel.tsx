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
    MigrateStoryUserStateCommand,
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

import { StoryActionsSection } from "./story-panel/story-actions";
import { StorySplitSection } from "./story-panel/split";
import { StoryOrganizationSection } from "./story-panel/organization";
import { StoryLinkEntitySection } from "./story-panel/link-entity";
import { StoryTopicSection } from "./story-panel/topic-join";
import { EvidenceSection } from "./story-panel/evidence";
import { HistoryShellSection } from "./story-panel/history-shell";
import { StoryUserStateMigrationSection } from "./story-panel/user-state-migration";
import type { StoryUserStateSnapshot } from "./story-panel/user-state-migration";
import { RelatedSection } from "./story-panel/related";
import { SourceMembersSection } from "./story-panel/source-members";

import {
    STORY_KIND_LABELS,
    relationTypeLabel,
} from "./story-panel/labels";
import { TimelineSection } from "./story-panel/timeline-section";
import { SplitTargetSelect } from "./story-panel/split-target-select";
import { EntityRow } from "./story-panel/entity-row";
import { RevisionAssets } from "./story-panel/revision-assets";
import {
    StorySubtypeSelect,
    registeredStorySubtype,
} from "./story-panel/story-subtype-select";
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
    /** 读取拆分家族某个成员上的 Story 级用户状态（ADR-0020 迁移表单的来源侧）。 */
    onLoadStoryUserState?: (storyId: string) => Promise<StoryUserStateSnapshot>;
    /** 在同一个拆分家族内迁移 Story 级用户状态；反向调用即撤销。 */
    onMigrateStoryUserState?: (input: {
        sourceStoryId: string;
        command: MigrateStoryUserStateCommand;
    }) => Promise<void>;
};

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
    onLoadStoryUserState,
    onMigrateStoryUserState,
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
                    <SourceMembersSection story={story} title={title} relatedStories={relatedStories} />
                    {isShell && <HistoryShellSection busy={busy} kind={kind} onOpenRelatedStory={onOpenRelatedStory} story={story} title={title} />}
                    {isShell && onLoadStoryUserState && onMigrateStoryUserState && (
                        <StoryUserStateMigrationSection
                            busy={busy}
                            onLoadSource={onLoadStoryUserState}
                            onMigrate={onMigrateStoryUserState}
                            story={story}
                        />
                    )}
                    <EvidenceSection busy={busy} entryOptions={entryOptions} linkEntryId={linkEntryId} linkRelationType={linkRelationType} onLinkEntry={onLinkEntry} onUnlinkEntry={onUnlinkEntry} setLinkEntryId={setLinkEntryId} setLinkRelationType={setLinkRelationType} story={story} submitLinkEntry={submitLinkEntry} submitUnlinkEntry={submitUnlinkEntry} title={title} />
                    <TimelineSection events={timeline} />
                    <RelatedSection busy={busy} onOpenRelatedStory={onOpenRelatedStory} relatedStories={relatedStories} story={story} title={title} />
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
                    <StoryActionsSection busy={busy} isShell={isShell} kind={kind} mergeStoryId={mergeStoryId} onSplitStory={onSplitStory} setKind={setKind} setMergeStoryId={setMergeStoryId} setSubtype={setSubtype} setTitle={setTitle} story={story} submitMerge={submitMerge} submitRevisionUpdate={submitRevisionUpdate} subtype={subtype} subtypeOptions={subtypeOptions} title={title} />
                    <StorySplitSection addSplitSuccessor={addSplitSuccessor} busy={busy} isShell={isShell} onSplitStory={onSplitStory} setSplitEntityTargets={setSplitEntityTargets} setSplitEntryTargets={setSplitEntryTargets} setSplitEvidenceTargets={setSplitEvidenceTargets} setSplitTopicTargets={setSplitTopicTargets} splitEntityTargets={splitEntityTargets} splitEntryTargets={splitEntryTargets} splitEvidenceTargets={splitEvidenceTargets} splitSuccessors={splitSuccessors} splitTopicTargets={splitTopicTargets} story={story} submitSplit={submitSplit} subtypeOptions={subtypeOptions} topics={topics} updateSplitSuccessor={updateSplitSuccessor} />
                    {actionError && (
                        <p
                            role="alert"
                            className="text-sm text-destructive"
                            data-story-action-error="true"
                        >
                            {actionError}
                        </p>
                    )}
                    <StoryOrganizationSection annotations={annotations} attachLabelId={attachLabelId} attachableLabels={attachableLabels} busy={busy} cancelEditAnnotation={cancelEditAnnotation} collections={collections} editingAnnotationBody={editingAnnotationBody} editingAnnotationId={editingAnnotationId} editingAnnotationQuote={editingAnnotationQuote} newAnnotationBody={newAnnotationBody} newAnnotationQuote={newAnnotationQuote} newCollectionName={newCollectionName} newLabelName={newLabelName} onAttachLabel={onAttachLabel} onCreateAnnotation={onCreateAnnotation} onCreateCollection={onCreateCollection} onCreateLabel={onCreateLabel} onDeleteAnnotation={onDeleteAnnotation} onDetachLabel={onDetachLabel} onPinToBoard={onPinToBoard} onToggleCollection={onToggleCollection} onToggleFavorite={onToggleFavorite} onUpdateAnnotation={onUpdateAnnotation} setAttachLabelId={setAttachLabelId} setEditingAnnotationBody={setEditingAnnotationBody} setEditingAnnotationQuote={setEditingAnnotationQuote} setNewAnnotationBody={setNewAnnotationBody} setNewAnnotationQuote={setNewAnnotationQuote} setNewCollectionName={setNewCollectionName} setNewLabelName={setNewLabelName} startEditAnnotation={startEditAnnotation} story={story} submitAttachLabel={submitAttachLabel} submitCreateAnnotation={submitCreateAnnotation} submitCreateCollection={submitCreateCollection} submitCreateLabel={submitCreateLabel} submitDeleteAnnotation={submitDeleteAnnotation} submitDetachLabel={submitDetachLabel} submitPinToBoard={submitPinToBoard} submitToggleCollection={submitToggleCollection} submitToggleFavorite={submitToggleFavorite} submitUpdateAnnotation={submitUpdateAnnotation} />
                    <StoryLinkEntitySection busy={busy} entityOptions={entityOptions} linkEntityId={linkEntityId} newEntityName={newEntityName} newEntityType={newEntityType} onCreateEntityLinked={onCreateEntityLinked} setLinkEntityId={setLinkEntityId} setNewEntityName={setNewEntityName} setNewEntityType={setNewEntityType} story={story} submitCreateEntity={submitCreateEntity} submitLinkEntity={submitLinkEntity} submitUnlinkEntity={submitUnlinkEntity} />
                    <StoryTopicSection busy={busy} joinRole={joinRole} joinTopicId={joinTopicId} newTopicPurpose={newTopicPurpose} newTopicTitle={newTopicTitle} onCreateTopic={onCreateTopic} setJoinRole={setJoinRole} setJoinTopicId={setJoinTopicId} setNewTopicPurpose={setNewTopicPurpose} setNewTopicTitle={setNewTopicTitle} submitCreateTopic={submitCreateTopic} submitJoinTopic={submitJoinTopic} topics={topics} />
                </div>
            </div>
        </div>
    );
}
