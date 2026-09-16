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
    mergeStoryId: string;
    setKind: Dispatch<SetStateAction<StoryDetail["story"]["kind"]>>;
    setMergeStoryId: Dispatch<SetStateAction<string>>;
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
    mergeStoryId,
    setKind,
    setMergeStoryId,
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
                    className="grid gap-4 border-t pt-4"
                >
                    <form
                        aria-label="编辑 Story 表示"
                        className="grid gap-4"
                        onSubmit={submitRevisionUpdate}
                    >
                        <div className="flex flex-wrap items-center gap-2">
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
        </>
    );
}
