import { storyTimeRangeSchema, type StoryTimeRange } from "@cosmos/contracts";

/**
 * Story 时间范围的表单映射（ADR-0021 决定 2）。
 *
 * 表单把「一个起止端点」拆成三种互斥填法：准确时刻、只有原文、留空。浏览器端不能
 * import `@cosmos/domain`（它静态 import `node:crypto`），所以「填法 → TemporalValue」
 * 的映射在这里重写一份，精度与 `lowerBound` 口径与 Entry 侧保持一致。
 */

/** 表单只提供天/月/年三档原文粒度，精确时刻走 `datetime-local`。 */
export const STORY_RAW_PRECISIONS = ["day", "month", "year"] as const;

export type StoryRawPrecision = (typeof STORY_RAW_PRECISIONS)[number];

export type StoryBoundMode = "none" | "exact" | "raw";

export type StoryBoundDraft = {
    mode: StoryBoundMode;
    /** `datetime-local` 的值，形如 `2026-09-14T09:30`。 */
    exactInput: string;
    raw: string;
    precision: StoryRawPrecision;
};

export type StoryTimeRangeDraft = {
    start: StoryBoundDraft;
    end: StoryBoundDraft;
};

export const STORY_RAW_PRECISION_LABELS: Record<StoryRawPrecision, string> = {
    day: "天",
    month: "月",
    year: "年",
};

export function emptyStoryBoundDraft(): StoryBoundDraft {
    return { mode: "none", exactInput: "", raw: "", precision: "day" };
}

export function emptyStoryTimeRangeDraft(): StoryTimeRangeDraft {
    return { start: emptyStoryBoundDraft(), end: emptyStoryBoundDraft() };
}

export function storyTimeRangeToDraft(timeRange: StoryTimeRange | null | undefined): StoryTimeRangeDraft {
    if (!timeRange) {
        return emptyStoryTimeRangeDraft();
    }
    return {
        start: temporalValueToDraft(timeRange.start),
        end: timeRange.end ? temporalValueToDraft(timeRange.end) : emptyStoryBoundDraft(),
    };
}

function isRawPrecision(value: string | undefined): value is StoryRawPrecision {
    return value !== undefined && (STORY_RAW_PRECISIONS as readonly string[]).includes(value);
}

function temporalValueToDraft(value: StoryTimeRange["start"]): StoryBoundDraft {
    if (value.exact !== null) {
        return { mode: "exact", exactInput: exactToLocalInput(value.exact), raw: "", precision: "day" };
    }
    const fallback = value.fallback;
    if (!fallback) {
        return emptyStoryBoundDraft();
    }
    return {
        mode: "raw",
        exactInput: "",
        raw: fallback.raw,
        // 「昨天下午」这类只有原文的旧数据精度可能是 unknown；表单没有这一档，
        // 落到最细的天，重存时不会把原文说成比实际更粗。
        precision: isRawPrecision(fallback.precision) ? fallback.precision : "day",
    };
}

/** `datetime-local` 只接受本地时钟读数，所以按本地字段还原，不截 ISO 的 UTC 部分。 */
function exactToLocalInput(exact: string): string {
    const at = new Date(exact);
    if (Number.isNaN(at.getTime())) {
        return "";
    }
    const pad = (value: number): string => String(value).padStart(2, "0");
    return [
        `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
        `${pad(at.getHours())}:${pad(at.getMinutes())}`,
    ].join("T");
}

function boundToTemporalValue(bound: StoryBoundDraft): StoryTimeRange["start"] | null {
    if (bound.mode === "exact") {
        if (!bound.exactInput) {
            return null;
        }
        const at = new Date(bound.exactInput);
        if (Number.isNaN(at.getTime())) {
            return null;
        }
        return { exact: at.toISOString(), exactPrecision: "second" as const, fallback: null };
    }
    if (bound.mode === "raw") {
        const raw = bound.raw.trim();
        if (!raw) {
            return null;
        }
        return {
            exact: null,
            exactPrecision: null,
            fallback: {
                raw,
                lowerBound: precisionLowerBound(new Date(), bound.precision),
                precision: bound.precision,
                timezone: null,
                confidence: "uncertain" as const,
            },
        };
    }
    return null;
}

/**
 * 原文粒度的下界：该粒度起点的本地时间。由本地字段构造再转 ISO，跨时区不会把
 * 「2026 年」解成前一年的某一刻（ADR-0021 决定 2：不退化成 2026-01-01 这种假装）。
 */
function precisionLowerBound(at: Date, precision: StoryRawPrecision): string {
    const local = new Date(at.getTime());
    local.setMilliseconds(0);
    local.setSeconds(0);
    local.setMinutes(0);
    local.setHours(0);
    if (precision === "month" || precision === "year") {
        local.setDate(1);
    }
    if (precision === "year") {
        local.setMonth(0);
    }
    return local.toISOString();
}

/** 起止都选了精确时刻且结束早于开始时说明用户填反了；原文模式无法比较，不拦。 */
export function storyTimeRangeOrderError(draft: StoryTimeRangeDraft): string | null {
    const start = boundToTemporalValue(draft.start);
    const end = boundToTemporalValue(draft.end);
    if (!start?.exact || !end?.exact) {
        return null;
    }
    if (Date.parse(end.exact) >= Date.parse(start.exact)) {
        return null;
    }
    return "结束时间早于开始时间；请调整时间范围，或把结束时间留空。";
}

export type StoryTimeRangeFormResult =
    | { ok: true; timeRange: StoryTimeRange | null }
    | { ok: false; error: string };

/**
 * 全量提交：整个时间范围都不填就是 `null`（清空）；只填结束视为未定，与「只有
 * start 表示起点已知」的语义一致。
 */
export function storyTimeRangeFromDraft(draft: StoryTimeRangeDraft): StoryTimeRangeFormResult {
    const orderError = storyTimeRangeOrderError(draft);
    if (orderError) {
        return { ok: false, error: orderError };
    }
    const start = boundToTemporalValue(draft.start);
    const end = boundToTemporalValue(draft.end);
    if (!start) {
        if (end) {
            return { ok: false, error: "填了结束时间但没有开始时间；请先填开始时间。" };
        }
        return { ok: true, timeRange: null };
    }
    const parsed = storyTimeRangeSchema.safeParse({ start, end });
    if (!parsed.success) {
        return { ok: false, error: "时间范围不合法；请检查开始与结束时间的填法。" };
    }
    return { ok: true, timeRange: parsed.data };
}
