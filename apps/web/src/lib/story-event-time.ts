import type { StoryKeyFact, StoryTimeRange, TemporalValue } from "@cosmos/contracts";

/**
 * Story 事件时间的展示口径（ADR-0021 决定 2）：有准确时刻按本地时间显示到分钟，
 * 只有原文时显示原文并标注不精确，两者都没有就不显示这一行。
 * 维度只看「精确到什么程度」这一个问题，因此不区分日/月/年三档文案。
 */

export type StoryEventTimeView = {
    text: string;
    /** 任一端只有原文时为 true，由调用方渲染「不精确」提示。 */
    uncertain: boolean;
};

export function storyEventTimeView(timeRange: StoryTimeRange | null | undefined): StoryEventTimeView | null {
    if (!timeRange) {
        return null;
    }
    const start = boundView(timeRange.start);
    const end = timeRange.end ? boundView(timeRange.end) : null;
    if (!start && !end) {
        return null;
    }
    return {
        text: [start?.text, end?.text].filter((part): part is string => part !== undefined).join(" – "),
        uncertain: start?.uncertain === true || end?.uncertain === true,
    };
}

function boundView(value: TemporalValue): { text: string; uncertain: boolean } | null {
    if (value.exact !== null) {
        return { text: formatLocalMinute(value.exact), uncertain: false };
    }
    if (value.fallback) {
        return { text: value.fallback.raw, uncertain: true };
    }
    return null;
}

/** 本地时间到分钟；秒与毫秒在这里没有展示意义（表单精确模式仍按秒存储）。 */
function formatLocalMinute(exact: string): string {
    const at = new Date(exact);
    if (Number.isNaN(at.getTime())) {
        return exact;
    }
    const pad = (value: number): string => String(value).padStart(2, "0");
    return [
        `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
        `${pad(at.getHours())}:${pad(at.getMinutes())}`,
    ].join(" ");
}

/** 出处的条目可能已被删除；只有出现在当前候选列表里才算还存在（ADR-0021 决定 3）。 */
export function keyFactSourceLabel(
    fact: StoryKeyFact,
    sources: readonly { id: string; title: string }[],
): string | null {
    if (fact.entryId === null) {
        return null;
    }
    const match = sources.find((source) => source.id === fact.entryId);
    return match ? match.title : "出处已删除";
}
