import { useEffect, useState, type FormEventHandler } from "react";

import type {
    Annotation,
    CollectionSummary,
    EntitySummary,
    EntryListItem,
    EntryRelationType,
    EntryStoryRelationType,
    LabelRef,
    MigrateStoryUserStateCommand,
    SplitStoryCommand,
    StoryDetail,
    StorySubtype,
    TopicMemberRole,
    TopicSummary,
    UpdateStoryRevisionCommand,
} from "@cosmos/contracts";

import { Button } from "@/components/ui/button";
import { buildStoryTimeline } from "@/lib/story-timeline";
import type { RelatedStory } from "@/lib/related-stories";

import { StoryOrganizationEditor } from "./story-edit/organization-editor";
import { StoryActionsSection } from "./story-panel/story-actions";
import { StorySplitSection } from "./story-panel/split";
import { EvidenceSection } from "./story-panel/evidence";
import { HistoryShellSection } from "./story-panel/history-shell";
import { StoryUserStateMigrationSection } from "./story-panel/user-state-migration";
import type { StoryUserStateSnapshot } from "./story-panel/user-state-migration";
import { RelatedSection } from "./story-panel/related";
import { SourceMembersSection } from "./story-panel/source-members";
import type { StoryEntryOption } from "./story-panel/entry-option";
import {
    storyKeyFactsFromDraft,
    storyKeyFactsToDraft,
    type StoryKeyFactDraft,
} from "./story-panel/representation-form";
import {
    storyTimeRangeFromDraft,
    storyTimeRangeToDraft,
    type StoryTimeRangeDraft,
} from "@/lib/story-time-range-draft";

import { TimelineSection } from "./story-panel/timeline-section";
import { RevisionAssets } from "./story-panel/revision-assets";
import { registeredStorySubtype } from "./story-panel/story-subtype-select";

/**
 * 可编辑草稿的完整快照。
 *
 * 两侧都经这一个函数构造，字段集合与顺序因此一致，`JSON.stringify` 比较才是可靠的
 * 「有没有未保存的编辑」。草稿是小而扁平的 JSON 安全结构，逐字段比较不值得。
 */
type StoryDraftBaseline = {
    title: string;
    kind: StoryDetail["story"]["kind"];
    subtype: string | null;
    timeRange: StoryTimeRangeDraft;
    keyFacts: StoryKeyFactDraft[];
};

function storyDraftBaseline(
    story: StoryDetail,
    draft?: Omit<StoryDraftBaseline, never>,
): StoryDraftBaseline {
    if (draft !== undefined) {
        return draft;
    }
    return {
        title: story.story.title,
        kind: story.story.kind,
        subtype: story.story.subtype,
        timeRange: storyTimeRangeToDraft(story.story.timeRange),
        keyFacts: storyKeyFactsToDraft(story.story.keyFacts),
    };
}

type StoryEditSurfaceProps = {
    story: StoryDetail;
    onUpdateStoryRevision: (command: UpdateStoryRevisionCommand) => Promise<void>;
    onMergeStory: (obsoleteStoryId: string) => Promise<void>;
    /** 受管理 subtype 目录（ORG-013）；读取失败时下拉只有「无 subtype」。 */
    subtypeOptions?: readonly StorySubtype[];
    /** 拆分 Story（ADR-0012）：一次提交全部后继与显式关系映射。 */
    onSplitStory?: (command: SplitStoryCommand) => Promise<void>;
    topics?: readonly TopicSummary[];
    onJoinTopic?: (topicId: string, role: TopicMemberRole) => Promise<void>;
    entityOptions?: readonly EntitySummary[];
    onLinkEntity?: (entityId: string) => Promise<void>;
    onUnlinkEntity?: (entityId: string) => Promise<void>;
    labelOptions?: readonly LabelRef[];
    collections?: readonly Pick<CollectionSummary, "id" | "name" | "containsStory">[];
    onToggleFavorite?: (favorited: boolean) => Promise<void>;
    onAttachLabel?: (labelId: string) => Promise<void>;
    onDetachLabel?: (labelId: string) => Promise<void>;
    onToggleCollection?: (collectionId: string, member: boolean) => Promise<void>;
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
    /** 关键事实出处候选：本 Story 的成员 + 全量已加载条目（ADR-0021 决定 3）。 */
    entryCandidates?: readonly StoryEntryOption[];
    onLinkEntry?: (input: { entryId: string; relationType: EntryStoryRelationType }) => Promise<void>;
    onUnlinkEntry?: (entryId: string) => Promise<void>;
    /** 条目↔条目重复/转载关系（ADR-0022）：成员行上标记、改类型与解除。 */
    onLinkEntryRelation?: (input: {
        fromEntryId: string;
        toEntryId: string;
        relationType: EntryRelationType;
    }) => Promise<void>;
    onUnlinkEntryRelation?: (input: {
        fromEntryId: string;
        toEntryId: string;
    }) => Promise<void>;
    /** 读取拆分家族某个成员上的 Story 级用户状态（ADR-0020 迁移表单的来源侧）。 */
    onLoadStoryUserState?: (storyId: string) => Promise<StoryUserStateSnapshot>;
    /** 在同一个拆分家族内迁移 Story 级用户状态；反向调用即撤销。 */
    onMigrateStoryUserState?: (input: {
        sourceStoryId: string;
        command: MigrateStoryUserStateCommand;
    }) => Promise<void>;
    /**
     * 上报「有没有未保存的编辑」。阅读页据此决定后台事件到达时是静默重读还是先问用户
     * （ADR-0029 决策 7：正在编辑时不覆盖）。
     */
    onUnsavedChange?: (unsaved: boolean) => void;
};

/**
 * Story 的编辑与关联面：只放会写入 Story 的动作，只读区块留在阅读页。
 * 取代切片 3 之前的阅读抽屉——ADR-0029 决策 7 把 Story 改为独立页面，
 * 决策 1 要求关联动作仍在 Story 上就地发生。
 * 默认收起：阅读页以宽度与安静优先，编辑动作按需展开。
 */
export function StoryEditSurface({
    story,
    onUpdateStoryRevision,
    onMergeStory,
    onSplitStory,
    subtypeOptions = [],
    topics,
    onJoinTopic,
    entityOptions,
    onLinkEntity,
    onUnlinkEntity,
    labelOptions,
    collections,
    onToggleFavorite,
    onAttachLabel,
    onDetachLabel,
    onToggleCollection,
    annotations,
    onCreateAnnotation,
    onUpdateAnnotation,
    onDeleteAnnotation,
    onPinToBoard,
    relatedStories = [],
    onOpenRelatedStory,
    entryOptions = [],
    entryCandidates,
    onLinkEntry,
    onUnlinkEntry,
    onLinkEntryRelation,
    onUnlinkEntryRelation,
    onLoadStoryUserState,
    onMigrateStoryUserState,
    onUnsavedChange,
}: StoryEditSurfaceProps) {
    const [title, setTitle] = useState(story.story.title);
    const [kind, setKind] = useState<StoryDetail["story"]["kind"]>(story.story.kind);
    // A subtype already stored on the Story may be unregistered legacy data;
    // keeping it unchanged is allowed, so it must stay selectable.
    const [subtype, setSubtype] = useState<string | null>(story.story.subtype);
    const [mergeStoryId, setMergeStoryId] = useState("");
    const [timeRangeDraft, setTimeRangeDraft] = useState<StoryTimeRangeDraft>(
        () => storyTimeRangeToDraft(story.story.timeRange),
    );
    const [keyFactsDraft, setKeyFactsDraft] = useState<StoryKeyFactDraft[]>(
        () => storyKeyFactsToDraft(story.story.keyFacts),
    );
    const [actionError, setActionError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
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
    const [editing, setEditing] = useState(false);

    /*
     * 「有没有未保存的编辑」以**上次同步时的服务端状态**为基准，而不是当前的 `story`：
     * 阅读页会在事件到达时后台静默重读，`story` 因此会变；拿它当基准的话，用户什么都没动
     * 也会立刻被算成「正在编辑」，于是从此再也收不到静默重读。
     * 用户确认「重新读取」时由阅读页换 `key` 重挂载本组件，草稿与基准一起重新初始化。
     */
    const [baseline, setBaseline] = useState<StoryDraftBaseline>(() => storyDraftBaseline(story));
    const unsaved = JSON.stringify(storyDraftBaseline(story, {
        title,
        kind,
        subtype,
        timeRange: timeRangeDraft,
        keyFacts: keyFactsDraft,
    })) !== JSON.stringify(baseline);

    useEffect(() => {
        onUnsavedChange?.(unsaved);
    }, [onUnsavedChange, unsaved]);

    const currentRevision = story.entry?.revisions[0];
    const timeline = buildStoryTimeline(story);
    const isShell = story.story.status === "split";
    // 出处候选：页面给了全量清单就用它（含本 Story 成员标记），否则退回面板已有的
    // 条目选项，保证「出处已删除」这类判断仍能基于当前加载到的条目。
    const keyFactSources: StoryEntryOption[] = entryCandidates
        ? [...entryCandidates]
        : [
            ...story.entries.map((member) => ({
                id: member.id,
                title: member.revisions[0]?.title ?? member.id,
                sourceName: member.sourceName,
                isMember: true,
            })),
            ...entryOptions.map((option) => ({ ...option, isMember: false })),
        ];
    const submitRevisionUpdate: FormEventHandler = async (event) => {
        event.preventDefault();
        const normalized = title.trim();
        if (!normalized) {
            return;
        }
        const timeRange = storyTimeRangeFromDraft(timeRangeDraft);
        if (!timeRange.ok) {
            setActionError(timeRange.error);
            return;
        }
        const keyFacts = storyKeyFactsFromDraft(keyFactsDraft);
        if (keyFacts.some((fact) => fact.text.length === 0)) {
            setActionError("每条关键事实都需要文字；不需要的请删除。");
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
                timeRange: timeRange.timeRange,
                keyFacts,
            });
            // 保存后把表单对齐到刚落库的值：清掉「点了删除但没保存」这类未提交编辑，
            // 并把「未保存」的基准前移到刚落库的这一版。
            setTimeRangeDraft(storyTimeRangeToDraft(timeRange.timeRange));
            setKeyFactsDraft(storyKeyFactsToDraft(keyFacts));
            setBaseline(storyDraftBaseline(story, {
                title: normalized,
                kind,
                subtype,
                timeRange: storyTimeRangeToDraft(timeRange.timeRange),
                keyFacts: storyKeyFactsToDraft(keyFacts),
            }));
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

    /**
     * 成员行的来源标记按 Story 的 producer 取（ADR-0028）：一个 Story 的成员同属一次
     * 归并结果，不会出现成员之间写入者不同的情形。
     */
    const producers: Record<string, string | null> = {};
    for (const member of story.entries) {
        producers[member.id] = story.story.producer;
    }

    return (
        <div className="flex w-full flex-col gap-6" data-story-edit-surface="true">
            <SourceMembersSection
                busy={busy}
                candidates={entryCandidates ?? []}
                onLinkEntryRelation={onLinkEntryRelation}
                onUnlinkEntryRelation={onUnlinkEntryRelation}
                producers={producers}
                story={story}
            />
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
                    <RevisionAssets assets={currentRevision?.assets ?? []} />

                    <section aria-label="编辑与关联" className="flex flex-col gap-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <h2 className="font-display text-lg font-semibold tracking-tight">编辑与关联</h2>
                            <Button
                                aria-expanded={editing}
                                onClick={() => setEditing((value) => !value)}
                                size="sm"
                                variant="outline"
                            >
                                {editing ? "收起" : "展开"}
                            </Button>
                        </div>
                        {editing ? (
                            <>
                    <StoryActionsSection busy={busy} isShell={isShell} keyFactEntryOptions={keyFactSources} keyFactsDraft={keyFactsDraft} kind={kind} mergeStoryId={mergeStoryId} onKeyFactsDraftChange={setKeyFactsDraft} onTimeRangeDraftChange={setTimeRangeDraft} setKind={setKind} setMergeStoryId={setMergeStoryId} setSubtype={setSubtype} setTitle={setTitle} submitMerge={submitMerge} submitRevisionUpdate={submitRevisionUpdate} subtype={subtype} subtypeOptions={subtypeOptions} timeRangeDraft={timeRangeDraft} title={title} />
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
                    <StoryOrganizationEditor
                        annotations={annotations}
                        busy={busy}
                        collections={collections}
                        entityOptions={entityOptions}
                        labelOptions={labelOptions}
                        onAttachLabel={onAttachLabel}
                        onCreateAnnotation={onCreateAnnotation}
                        onDeleteAnnotation={onDeleteAnnotation}
                        onDetachLabel={onDetachLabel}
                        onJoinTopic={onJoinTopic}
                        onLinkEntity={onLinkEntity}
                        onPinToBoard={onPinToBoard}
                        onToggleCollection={onToggleCollection}
                        onToggleFavorite={onToggleFavorite}
                        onUnlinkEntity={onUnlinkEntity}
                        onUpdateAnnotation={onUpdateAnnotation}
                        setActionError={setActionError}
                        setBusy={setBusy}
                        story={story}
                        topics={topics}
                    />
                            </>
                        ) : (
                            <p className="text-sm leading-6 text-muted-foreground">
                                改标题与关键事实、归并、拆分、打标签、写批注、加入话题、关联 Entity 都在这里展开。
                            </p>
                        )}
                    </section>
        </div>
    );
}
