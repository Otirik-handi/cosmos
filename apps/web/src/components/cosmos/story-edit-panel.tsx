import { useEffect, useState, type FormEventHandler } from "react";

import { storySplitSuccessorMinCount } from "@cosmos/contracts";
import type {
    Annotation,
    CollectionSummary,
    EntitySummary,
    MigrateStoryUserStateCommand,
    SplitStoryCommand,
    StoryDetail,
    StorySubtype,
    TopicMemberRole,
    TopicSummary,
    UpdateStoryRevisionCommand,
    LabelRef,
} from "@cosmos/contracts";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { messages } from "@/copy/messages";
import {
    storyTimeRangeFromDraft,
    storyTimeRangeToDraft,
    type StoryTimeRangeDraft,
} from "@/lib/story-time-range-draft";

import { StoryActionsSection } from "./story-panel/story-actions";
import type { MergeTargetCandidate } from "./story-panel/merge-target-select";
import { StorySplitSection } from "./story-panel/split";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { HistoryShellSection } from "./story-panel/history-shell";
import { StoryUserStateMigrationSection } from "./story-panel/user-state-migration";
import type { StoryUserStateSnapshot } from "./story-panel/user-state-migration";
import type { StoryEntryOption } from "./story-panel/entry-option";
import { StoryMarkingEditor } from "./story-edit/marking-editor";
import { StoryEntitiesEditor } from "./story-edit/entities-editor";
import {
    storyKeyFactsFromDraft,
    storyKeyFactsToDraft,
    type StoryKeyFactDraft,
} from "./story-panel/representation-form";
import { registeredStorySubtype } from "./story-panel/story-subtype-select";

/**
 * 四段的段标题。层级夹在面板总标题（`text-lg`，`编辑与关联`）与字段标题（`font-medium`，
 * 如「标签」「时间范围」）之间：比字段重、比面板轻，读者一眼能分出「这一段在管什么」。
 */
function SegmentTitle({ children }: { children: string }) {
    return (
        <h3 className="font-display text-base font-semibold tracking-tight">{children}</h3>
    );
}

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
    draft?: StoryDraftBaseline,
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

/**
 * Story 阅读页右栏：会改写 Story 的动作与编排。
 *
 * 取代 Task 36 切片 A 之前的 `story-edit-surface`——那个组件同时承载只读区块，
 * 无法按两栏版面与左栏分开摆放。判据是「它会不会写」：收藏、改表示、归并、拆分、
 * 打标签、批注、话题、Entity、收藏夹、固定到看板，以及拆分壳的用户状态迁移都在这里；
 * 成员行、证据、相关内容、时间线、媒体留在左栏。
 * 「编辑与关联」自 2026-10-03 起**默认展开**（维护者裁定）：右栏本来就是操作栏，
 * 再点一次才出现表单是多余的一步。
 */
type Props = {
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
    onToggleFavorite?: () => Promise<void>;
    togglingFavorite?: boolean;
    /** 打开拆分家族里的后继 Story（历史壳的「已拆分为 N 条」列表）。 */
    onOpenRelatedStory?: (storyId: string) => Promise<void>;
    /**
     * 按标题搜索归并目标。候选复用既有 `GET /search`，不新增读查询；调用方负责按
     * storyId 去重并排除当前 Story（`MergeTargetSelect` 再兜一层排除）。
     */
    onSearchMergeTargets: (text: string) => Promise<readonly MergeTargetCandidate[]>;
    /** 关键事实出处候选：本 Story 的成员 + 全量已加载条目（ADR-0021 决定 3）。 */
    entryCandidates?: readonly StoryEntryOption[];
    entryOptions?: readonly { id: string; title: string; sourceName: string }[];
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
    /**
     * 左栏的成员行与证据表单也写入，因此 busy 与错误行由本组件持有、跨两栏共用：
     * 不共用的话，左栏失败的错误会显示在右栏看不见的地方，用户只看到按钮弹回来。
     */
    busy?: boolean;
    setBusy?: (busy: boolean) => void;
    actionError?: string | null;
    setActionError?: (message: string | null) => void;
};

export function StoryEditPanel({
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
    onAttachLabel,
    onDetachLabel,
    onToggleCollection,
    annotations,
    onCreateAnnotation,
    onUpdateAnnotation,
    onDeleteAnnotation,
    onPinToBoard,
    onToggleFavorite,
    onOpenRelatedStory,
    onSearchMergeTargets,
    entryCandidates,
    entryOptions = [],
    onLoadStoryUserState,
    onMigrateStoryUserState,
    onUnsavedChange,
    busy: controlledBusy,
    setBusy: setControlledBusy,
    actionError: controlledActionError,
    setActionError: setControlledActionError,
}: Props) {
    const [title, setTitle] = useState(story.story.title);
    const [kind, setKind] = useState<StoryDetail["story"]["kind"]>(story.story.kind);
    // A subtype already stored on the Story may be unregistered legacy data;
    // keeping it unchanged is allowed, so it must stay selectable.
    const [subtype, setSubtype] = useState<string | null>(story.story.subtype);
    /** 归并目标由选择器给出；`null` 表示还没选，提交按钮据此保持无操作。 */
    const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);
    const [timeRangeDraft, setTimeRangeDraft] = useState<StoryTimeRangeDraft>(
        () => storyTimeRangeToDraft(story.story.timeRange),
    );
    const [keyFactsDraft, setKeyFactsDraft] = useState<StoryKeyFactDraft[]>(
        () => storyKeyFactsToDraft(story.story.keyFacts),
    );
    const [localActionError, setLocalActionError] = useState<string | null>(null);
    const [localBusy, setLocalBusy] = useState(false);
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
    /** 拆分会把原条清空时先确认一次（见 submitSplit 里的说明）。 */
    const [confirmingEmptyShell, setConfirmingEmptyShell] = useState(false);
    const [editing, setEditing] = useState(true);

    const actionError = controlledActionError !== undefined ? controlledActionError : localActionError;
    const busy = controlledBusy !== undefined ? controlledBusy : localBusy;
    const setActionError = (message: string | null): void => {
        setControlledActionError?.(message);
        setLocalActionError(message);
    };
    const setBusy = (value: boolean): void => {
        setControlledBusy?.(value);
        setLocalBusy(value);
    };

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

    const isShell = story.story.status === "split";
    /*
     * 「拆分 Story」在成员少于 2 条时整块不渲染（组件自己返回空）。它前面的分隔线必须跟着
     * 同一条件——否则线还在、块不在，就成了一条孤儿线夹在归并与对象关联之间
     * （Task 36 Round 10 修的就是这个：那次实测看到两条相邻的线）。
     */
    const hasSplitSection = !isShell && story.entries.length >= 2;
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
            setActionError(messages.reading.storyEdit.keyFactNeedsText);
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
            setActionError(error instanceof Error ? error.message : messages.reading.storyEdit.updateFailed);
        } finally {
            setBusy(false);
        }
    };

    const submitMerge: FormEventHandler = async (event) => {
        event.preventDefault();
        const obsoleteStoryId = mergeTargetId?.trim() ?? "";
        if (!obsoleteStoryId) {
            return;
        }
        setBusy(true);
        setActionError(null);
        try {
            await onMergeStory(obsoleteStoryId);
            setMergeTargetId(null);
        } catch (error) {
            setActionError(error instanceof Error ? error.message : messages.reading.storyEdit.mergeFailed);
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

    /**
     * 删掉一个后继。
     *
     * 四张「成员/证据/实体/Topic → 后继序号」的映射必须一起重编号：它们存的是**下标**，
     * 直接删行会让被删行之后的分配整体前移一位、静默指到错误的后继上。
     * 指到被删行的分配改为 -1（留在本条），与「没有指定去向就留在本条」的既有规则一致。
     */
    const removeSplitSuccessor = (index: number): void => {
        setSplitSuccessors((current) => current.filter((_, position) => position !== index));
        const reindex = (targets: Record<string, number>): Record<string, number> => {
            const next: Record<string, number> = {};
            for (const [key, target] of Object.entries(targets)) {
                if (target === index) {
                    continue;
                }
                next[key] = target > index ? target - 1 : target;
            }
            return next;
        };
        setSplitEntryTargets(reindex);
        setSplitEvidenceTargets(reindex);
        setSplitEntityTargets(reindex);
        setSplitTopicTargets(reindex);
    };

    /**
     * 把当前表单状态翻译成合同里的后继清单。确认对话框和直接提交走同一条路径，
     * 避免「确认后重新拼一遍」导致两处映射规则漂移（四个 target 映射很容易写歪）。
     */
    const buildSplitSuccessors = (): SplitStoryCommand["successors"] =>
        splitSuccessors.map((successor, index) => ({
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

    const submitSplit: FormEventHandler = async (event) => {
        event.preventDefault();
        if (!onSplitStory) {
            return;
        }
        /*
         * 下限来自合同（`storySplitSuccessorMinCount`），不是界面自己定的数：
         * 拆成一条不是拆分。这里必须提前拦住——否则请求打到服务端才被 schema 拒绝，
         * 用户看到的是 Zod 的原始报错（维护者 2026-10-05 验收遇到的就是这个）。
         */
        if (splitSuccessors.length < storySplitSuccessorMinCount) {
            setActionError(messages.reading.storyEdit.splitNeedsSuccessors);
            return;
        }
        const titles = splitSuccessors.map((successor) => successor.title.trim());
        if (titles.some((value) => value.length === 0)) {
            setActionError(messages.reading.storyEdit.splitNeedsTitle);
            return;
        }
        const successors = buildSplitSuccessors();
        const emptyIndex = successors.findIndex((successor) => successor.entryIds.length === 0);
        if (emptyIndex >= 0) {
            setActionError(messages.reading.storyEdit.splitNeedsMember(titles[emptyIndex]));
            return;
        }
        /*
         * 所有成员都被分走时，原条会变成没有成员的历史壳。这不是错误（ADR-0012 决策 6
         * 明确允许零成员壳，也拒绝过「强制至少留一个成员」的方案），但后果用户看不见：
         * 壳没有 entry 投影，因此不再出现在信息库与看板里，而按 ADR-0020 批注、标签、
         * 收藏留在壳上不自动扇出。所以这里不阻止，只把后果说清楚再让用户确认。
         */
        if (story.entries.every((member) => (splitEntryTargets[member.id] ?? -1) >= 0)) {
            setConfirmingEmptyShell(true);
            return;
        }
        await performSplit(successors);
    };

    const performSplit = async (successors: SplitStoryCommand["successors"]): Promise<void> => {
        if (!onSplitStory) {
            return;
        }
        setBusy(true);
        setActionError(null);
        try {
            await onSplitStory({ successors });
        } catch (error) {
            setActionError(error instanceof Error ? error.message : messages.reading.storyEdit.splitFailed);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex w-full min-w-0 flex-col gap-5" data-story-edit-panel="true">
            {isShell && (
                <HistoryShellSection
                    busy={busy}
                    kind={kind}
                    onOpenRelatedStory={onOpenRelatedStory}
                    story={story}
                    title={title}
                />
            )}
            {isShell && (
                <Separator decorative />
            )}
            {isShell && onLoadStoryUserState && onMigrateStoryUserState && (
                <StoryUserStateMigrationSection
                    busy={busy}
                    onLoadSource={onLoadStoryUserState}
                    onMigrate={onMigrateStoryUserState}
                    story={story}
                />
            )}
            {isShell && (
                <Separator decorative />
            )}

            <section aria-label={messages.reading.storyEdit.sectionLabel} className="flex flex-col gap-5">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                    <h2 className="font-display text-lg font-semibold tracking-tight">
                        {messages.reading.storyEdit.sectionLabel}
                    </h2>
                    <Button
                        aria-expanded={editing}
                        onClick={() => setEditing((value) => !value)}
                        size="sm"
                        variant="outline"
                    >
                        {editing ? messages.reading.storyEdit.collapse : messages.reading.storyEdit.expand}
                    </Button>
                </div>
                <Separator decorative />
                {editing ? (
                    <>
                        {/*
                         * 四段按使用频率排（维护者 2026-10-03 裁定）：C 我的标记 → B 家族与关系 →
                         * A 内容与表示 → D 对象关联。分类判据是「改的是哪一层数据」：C 只写用户
                         * 标记、B 改多条 Story 的拓扑（归并与拆分）、A 改当前 Revision、D 改关系表。
                         * 详见 walkthrough Round 9。
                         *
                         * 段标题由本层统一渲染（维护者 2026-10-03：每一段要有一个 Title），
                         * 段组件自己不再重复标题。B 拆成「归并」「拆分」两处渲染，所以它的段标题
                         * 在前、两块内容紧随其后；「内容与表示」标题在 B 之后、拆分之前，不能并在
                         * B 的标题下。三条分割线仍是 C|B、B|A、A|D，位置与数量未变。
                         */}
                        <SegmentTitle>{messages.reading.storyEdit.marking.sectionLabel}</SegmentTitle>
                        <StoryMarkingEditor
                            annotations={annotations}
                            busy={busy}
                            collections={collections}
                            labelOptions={labelOptions}
                            onAttachLabel={onAttachLabel}
                            onCreateAnnotation={onCreateAnnotation}
                            onDeleteAnnotation={onDeleteAnnotation}
                            onDetachLabel={onDetachLabel}
                            onPinToBoard={onPinToBoard}
                            onToggleCollection={onToggleCollection}
                            onToggleFavorite={onToggleFavorite}
                            onUpdateAnnotation={onUpdateAnnotation}
                            setActionError={setActionError}
                            setBusy={setBusy}
                            story={story}
                        />
                        <Separator decorative />
                        <SegmentTitle>{messages.reading.storyEdit.segments.family}</SegmentTitle>
                        <StoryActionsSection
                            busy={busy}
                            currentStoryId={story.story.id}
                            isShell={isShell}
                            keyFactEntryOptions={keyFactSources}
                            keyFactsDraft={keyFactsDraft}
                            kind={kind}
                            onKeyFactsDraftChange={setKeyFactsDraft}
                            onSearchMergeTargets={onSearchMergeTargets}
                            onSelectMergeTarget={(candidate) => setMergeTargetId(candidate.storyId)}
                            onTimeRangeDraftChange={setTimeRangeDraft}
                            setKind={setKind}
                            setSubtype={setSubtype}
                            setTitle={setTitle}
                            submitMerge={submitMerge}
                            submitRevisionUpdate={submitRevisionUpdate}
                            subtype={subtype}
                            subtypeOptions={subtypeOptions}
                            timeRangeDraft={timeRangeDraft}
                            title={title}
                        />
                        {/*
                         * A 段的线与标题跟内容绑在同一个条件上：单成员 Story 没有拆分表单，
                         * 让标题单独出现会得到「有标题、下方空白、还多一条线」的空段。
                         */}
                        {hasSplitSection && (
                            <>
                                <Separator decorative />
                                <SegmentTitle>{messages.reading.storyEdit.segments.representation}</SegmentTitle>
                                <StorySplitSection
                            addSplitSuccessor={addSplitSuccessor}
                            busy={busy}
                            isShell={isShell}
                            onSplitStory={onSplitStory}
                            removeSplitSuccessor={removeSplitSuccessor}
                            setSplitEntityTargets={setSplitEntityTargets}
                            setSplitEntryTargets={setSplitEntryTargets}
                            setSplitEvidenceTargets={setSplitEvidenceTargets}
                            setSplitTopicTargets={setSplitTopicTargets}
                            splitEntityTargets={splitEntityTargets}
                            splitEntryTargets={splitEntryTargets}
                            splitEvidenceTargets={splitEvidenceTargets}
                            splitSuccessors={splitSuccessors}
                            splitTopicTargets={splitTopicTargets}
                            story={story}
                            submitSplit={submitSplit}
                            subtypeOptions={subtypeOptions}
                            topics={topics}
                            updateSplitSuccessor={updateSplitSuccessor}
                                />
                            </>
                        )}
                        <Separator decorative />
                        <SegmentTitle>{messages.reading.storyEdit.entities.sectionLabel}</SegmentTitle>                        <StoryEntitiesEditor
                            busy={busy}
                            entityOptions={entityOptions}
                            onJoinTopic={onJoinTopic}
                            onLinkEntity={onLinkEntity}
                            onUnlinkEntity={onUnlinkEntity}
                            setActionError={setActionError}
                            setBusy={setBusy}
                            story={story}
                            topics={topics}
                        />
                    </>
                ) : (
                    <p className="text-sm leading-6 text-muted-foreground">
                        {messages.reading.storyEdit.collapsedHint}
                    </p>
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
            </section>
            {/*
             * 确认后才真正提交。这里刻意用 alert-dialog 而不是 toast：后果不可从界面上撤销
             * （壳不在任何列表里，成员要回到壳得走「移回本条」），所以必须先讲清楚再让用户点。
             */}
            <AlertDialog open={confirmingEmptyShell} onOpenChange={setConfirmingEmptyShell}>
                <AlertDialogContent data-story-split-empty-shell="true">
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {messages.reading.storyEdit.splitEmptyShellTitle}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {messages.reading.storyEdit.splitEmptyShellBody}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{messages.reading.storyEdit.splitEmptyShellCancel}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                setConfirmingEmptyShell(false);
                                void performSplit(buildSplitSuccessors());
                            }}
                        >
                            {messages.reading.storyEdit.splitEmptyShellConfirm}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
