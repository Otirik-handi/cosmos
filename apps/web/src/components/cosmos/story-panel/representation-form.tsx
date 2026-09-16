import type { StoryKeyFact } from "@cosmos/contracts";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
    STORY_RAW_PRECISION_LABELS,
    STORY_RAW_PRECISIONS,
    type StoryBoundDraft,
    type StoryBoundMode,
    type StoryTimeRangeDraft,
} from "@/lib/story-time-range-draft";

import type { StoryEntryOption } from "./entry-option";

/** 表单编辑中的一条事实：出处用空字符串表示「无出处」，提交时才变成 null。 */
export type StoryKeyFactDraft = {
    text: string;
    entryId: string;
};

export function storyKeyFactsToDraft(facts: readonly StoryKeyFact[] | null | undefined): StoryKeyFactDraft[] {
    return (facts ?? []).map((fact) => ({ text: fact.text, entryId: fact.entryId ?? "" }));
}

export function storyKeyFactsFromDraft(draft: readonly StoryKeyFactDraft[]): StoryKeyFact[] {
    return draft.map((fact) => ({
        text: fact.text.trim(),
        entryId: fact.entryId.trim() || null,
    }));
}

type TimeRangeProps = {
    busy: boolean;
    draft: StoryTimeRangeDraft;
    onChange: (next: StoryTimeRangeDraft) => void;
};

const BOUND_MODES: readonly { value: StoryBoundMode; label: string }[] = [
    { value: "none", label: "未定" },
    { value: "exact", label: "准确时刻" },
    { value: "raw", label: "只有原文（不精确）" },
];

export function StoryTimeRangeForm({ busy, draft, onChange }: TimeRangeProps) {
    const updateBound = (bound: "start" | "end", patch: Partial<StoryBoundDraft>): void => {
        onChange({ ...draft, [bound]: { ...draft[bound], ...patch } });
    };
    const renderBound = (bound: "start" | "end", label: string): ReactNode => {
        const value = draft[bound];
        return (
            <fieldset
                data-story-time-bound={bound}
                className="grid gap-2 rounded-sm border bg-muted/20 px-3 py-2"
            >
                <legend className="px-1 text-sm font-medium">{label}</legend>
                <div className="flex flex-wrap items-center gap-3 text-sm">
                    {BOUND_MODES.map((mode) => (
                        <label key={mode.value} className="flex items-center gap-1.5">
                            <input
                                type="radio"
                                name={`story-time-${bound}-mode`}
                                value={mode.value}
                                checked={value.mode === mode.value}
                                disabled={busy}
                                onChange={() => updateBound(bound, { mode: mode.value })}
                            />
                            {mode.label}
                        </label>
                    ))}
                </div>
                {value.mode === "exact" && (
                    <Input
                        type="datetime-local"
                        aria-label={`${label}的准确时刻`}
                        value={value.exactInput}
                        disabled={busy}
                        className="max-w-xs"
                        onChange={(event) => updateBound(bound, { exactInput: event.target.value })}
                    />
                )}
                {value.mode === "raw" && (
                    <div className="flex flex-wrap items-center gap-2">
                        <Input
                            aria-label={`${label}的原文`}
                            value={value.raw}
                            disabled={busy}
                            placeholder="例如：昨天下午"
                            className="max-w-xs"
                            onChange={(event) => updateBound(bound, { raw: event.target.value })}
                        />
                        <label className="flex items-center gap-1.5 text-sm">
                            精确到
                            <select
                                aria-label={`${label}的原文精度`}
                                value={value.precision}
                                disabled={busy}
                                className="rounded-sm border bg-card px-2 py-1 text-sm"
                                onChange={(event) => updateBound(bound, {
                                    precision: event.target.value as StoryBoundDraft["precision"],
                                })}
                            >
                                {STORY_RAW_PRECISIONS.map((precision) => (
                                    <option key={precision} value={precision}>
                                        {STORY_RAW_PRECISION_LABELS[precision]}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                )}
            </fieldset>
        );
    };
    return (
        <section aria-label="时间范围" className="grid gap-3 border-t pt-4">
            <div>
                <h3 className="font-medium">时间范围</h3>
                <p className="text-sm text-muted-foreground">
                    填写这件事发生的时间；只填开始表示起点已知，两个都留空表示未定。
                </p>
            </div>
            {renderBound("start", "开始")}
            {renderBound("end", "结束（可留空）")}
        </section>
    );
}

type KeyFactsProps = {
    busy: boolean;
    draft: readonly StoryKeyFactDraft[];
    entryOptions: readonly StoryEntryOption[];
    onChange: (next: StoryKeyFactDraft[]) => void;
};

export function StoryKeyFactsForm({ busy, draft, entryOptions, onChange }: KeyFactsProps) {
    const members = entryOptions.filter((option) => option.isMember);
    const others = entryOptions.filter((option) => !option.isMember);
    const update = (index: number, patch: Partial<StoryKeyFactDraft>): void => {
        onChange(draft.map((fact, position) => (position === index ? { ...fact, ...patch } : fact)));
    };
    const move = (index: number, offset: number): void => {
        const target = index + offset;
        if (target < 0 || target >= draft.length) {
            return;
        }
        const next = [...draft];
        const [moved] = next.splice(index, 1);
        next.splice(target, 0, moved!);
        onChange(next);
    };
    return (
        <section aria-label="关键事实" className="grid gap-3 border-t pt-4">
            <div>
                <h3 className="font-medium">关键事实</h3>
                <p className="text-sm text-muted-foreground">
                    按你希望展示的顺序排列，每条最多选一条出处；没有合适的出处可以留空。
                </p>
            </div>
            {draft.length === 0 ? (
                <p className="text-sm text-muted-foreground">还没有关键事实。</p>
            ) : (
                <ol className="grid gap-3" data-story-key-fact-editor="true">
                    {draft.map((fact, index) => (
                        <li
                            key={index}
                            data-story-key-fact-index={index}
                            className="grid gap-2 rounded-sm border bg-muted/20 px-3 py-2"
                        >
                            <Textarea
                                aria-label={`第 ${index + 1} 条事实`}
                                value={fact.text}
                                disabled={busy}
                                rows={2}
                                placeholder="例如：上下文窗口 1M"
                                onChange={(event) => update(index, { text: event.target.value })}
                            />
                            <div className="flex flex-wrap items-center gap-2">
                                <select
                                    aria-label={`第 ${index + 1} 条事实的出处`}
                                    value={fact.entryId}
                                    disabled={busy}
                                    className="max-w-sm rounded-sm border bg-card px-2 py-1 text-sm"
                                    onChange={(event) => update(index, { entryId: event.target.value })}
                                >
                                    <option value="">无出处</option>
                                    {/* 出处指向的信息条目可能已被删除：保留原值让用户
                                        看见并可以改选，而不是静默丢掉（ADR-0021 决定 3）。 */}
                                    {fact.entryId !== "" && !entryOptions.some((option) => option.id === fact.entryId) && (
                                        <option value={fact.entryId}>
                                            出处已删除（{fact.entryId}）
                                        </option>
                                    )}
                                    {members.length > 0 && (
                                        <optgroup label="本 Story 的信息条目">
                                            {members.map((option) => (
                                                <option key={option.id} value={option.id}>
                                                    {option.sourceName} · {option.title}
                                                </option>
                                            ))}
                                        </optgroup>
                                    )}
                                    {others.length > 0 && (
                                        <optgroup label="其它信息条目">
                                            {others.map((option) => (
                                                <option key={option.id} value={option.id}>
                                                    {option.sourceName} · {option.title}
                                                </option>
                                            ))}
                                        </optgroup>
                                    )}
                                </select>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    aria-label={`上移第 ${index + 1} 条事实`}
                                    disabled={busy || index === 0}
                                    onClick={() => move(index, -1)}
                                >
                                    上移
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    aria-label={`下移第 ${index + 1} 条事实`}
                                    disabled={busy || index === draft.length - 1}
                                    onClick={() => move(index, 1)}
                                >
                                    下移
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    aria-label={`删除第 ${index + 1} 条事实`}
                                    disabled={busy}
                                    onClick={() => onChange(draft.filter((_, position) => position !== index))}
                                >
                                    删除
                                </Button>
                            </div>
                        </li>
                    ))}
                </ol>
            )}
            <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                data-testid="story-key-fact-add"
                disabled={busy}
                onClick={() => onChange([...draft, { text: "", entryId: "" }])}
            >
                添加事实
            </Button>
        </section>
    );
}
