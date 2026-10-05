import type {
    StorySubtype,
} from "@cosmos/contracts";
import { type Dispatch, type FormEventHandler, type SetStateAction } from "react";
import {
    StoryDetail,
} from "@cosmos/contracts";
import {
    Button,
} from "@/components/ui/button";
import {
    Input,
} from "@/components/ui/input";
import type { StoryTimeRangeDraft } from "@/lib/story-time-range-draft";
import type { StoryEntryOption } from "./entry-option";
import {
    MergeTargetSelect,
    type MergeTargetCandidate,
} from "./merge-target-select";
import {
    StoryKeyFactsForm,
    StoryTimeRangeForm,
    type StoryKeyFactDraft,
} from "./representation-form";
import {
    StorySubtypeSelect,
    registeredStorySubtype,
} from "./story-subtype-select";

type Props = {
    busy: boolean;
    isShell: boolean;
    kind: StoryDetail["story"]["kind"];
    /** 当前 Story：归并目标候选要排除它，避免「并入自己」。 */
    currentStoryId: string;
    /** 按标题搜索归并目标（复用 GET /search）。 */
    onSearchMergeTargets: (text: string) => Promise<readonly MergeTargetCandidate[]>;
    onSelectMergeTarget: (candidate: MergeTargetCandidate) => void;
    setKind: Dispatch<SetStateAction<StoryDetail["story"]["kind"]>>;
    setSubtype: Dispatch<SetStateAction<string | null>>;
    setTitle: Dispatch<SetStateAction<string>>;
    submitMerge: FormEventHandler;
    submitRevisionUpdate: FormEventHandler;
    subtype: string | null;
    subtypeOptions?: readonly StorySubtype[];
    title: string;
    /** 时间范围与关键事实的编辑中草稿；保存时与标题一起全量提交（ADR-0021 决定 5）。 */
    timeRangeDraft: StoryTimeRangeDraft;
    onTimeRangeDraftChange: (next: StoryTimeRangeDraft) => void;
    keyFactsDraft: readonly StoryKeyFactDraft[];
    keyFactEntryOptions: readonly StoryEntryOption[];
    onKeyFactsDraftChange: (next: StoryKeyFactDraft[]) => void;
};

export function StoryActionsSection({
    busy,
    isShell,
    kind,
    currentStoryId,
    onSearchMergeTargets,
    onSelectMergeTarget,
    setKind,
    setSubtype,
    setTitle,
    submitMerge,
    submitRevisionUpdate,
    subtype,
    subtypeOptions = [],
    title,
    timeRangeDraft,
    onTimeRangeDraftChange,
    keyFactsDraft,
    keyFactEntryOptions,
    onKeyFactsDraftChange,
}: Props) {
    return (
        <>
            {!isShell && (
                <section
                    aria-label="Story 操作"
                    className="flex flex-col gap-5"
                >
                    <form
                        aria-label="编辑 Story 表示"
                        className="grid gap-4"
                        onSubmit={submitRevisionUpdate}
                    >
                        {/*
                         * 标题独占一行；**类型与子类型同排**（维护者 2026-10-03）——它们是同一件事的
                         * 两个层级（分类 → 细分），放在一起读得通，合并后正好放得下右栏的宽度。
                         * 逐字段一行、标签与控件同排，是这个宽度下稳定的形态；`shrink-0` 让标签
                         * 不被下拉压掉。
                         */}
                        <div className="flex items-center gap-2">
                            <label
                                htmlFor="cosmos-story-title-edit"
                                className="shrink-0 text-sm font-medium"
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
                        </div>
                        <div className="flex items-center gap-2">
                            <label
                                htmlFor="cosmos-story-kind-edit"
                                className="shrink-0 text-sm font-medium"
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
                                className="shrink-0 text-sm font-medium"
                            >
                                子类型
                            </label>
                            <StorySubtypeSelect
                                id="cosmos-story-subtype-edit"
                                label="Story 子类型"
                                value={subtype}
                                kind={kind}
                                options={subtypeOptions}
                                disabled={busy}
                                onChange={setSubtype}
                            />
                        </div>
                        <StoryTimeRangeForm
                            busy={busy}
                            draft={timeRangeDraft}
                            onChange={onTimeRangeDraftChange}
                        />
                        <StoryKeyFactsForm
                            busy={busy}
                            draft={keyFactsDraft}
                            entryOptions={keyFactEntryOptions}
                            onChange={onKeyFactsDraftChange}
                        />
                        <Button type="submit" disabled={busy} variant="outline" className="w-fit">
                            保存修改
                        </Button>
                    </form>
                    {/*
                     * 归并与「改表示」是两个不同的锚点（面板会在两者之间插一条分隔线），
                     * 所以本组件内部不再放任何线——内部线与面板的段间线会叠成两条
                     * （Task 36 Round 10 修的就是这个）。
                     */}
                    <form
                        className="flex flex-col gap-2"
                        onSubmit={submitMerge}
                    >
                        <span className="text-sm font-medium" id="cosmos-story-merge-label">
                            并入本条的内容
                        </span>
                        {/*
                         * 选择器而不是输入框：判据 R3 不允许要求用户粘贴内部 Story ID。
                         * `aria-labelledby` 指向上面那行文字——Combobox 的输入框自带
                         * aria-label（搜索框的角色说明），两者分工不同，不能互相顶掉。
                         */}
                        <div aria-labelledby="cosmos-story-merge-label" className="max-w-sm" role="group">
                            <MergeTargetSelect
                                currentStoryId={currentStoryId}
                                disabled={busy}
                                onSearch={onSearchMergeTargets}
                                onSelect={onSelectMergeTarget}
                            />
                        </div>
                        <Button type="submit" disabled={busy} variant="outline" className="w-fit">
                            归并
                        </Button>
                    </form>
                </section>
            )}
        </>
    );
}
