import type { EntryRevisionSnapshot, StoryDetail } from "@cosmos/contracts";

export type StoryTimelineEvent = {
    id: string;
    /** 事件时间（ISO）；缺失时间的事件排在最旧，由 UI 隐藏日期。 */
    at: string | null;
    kind: string;
    sourceName: string;
    title: string;
    detail: string | null;
};

/** 时间线只服务阅读，不承担审计全量：单条 Story 最多渲染这么多事件。 */
const MAX_EVENTS = 50;

const OBSERVATION_KINDS: Record<string, string> = {
    create: "来源首次发布",
    update: "来源更新",
    delete: "来源删除",
    snapshot: "抓取快照",
};

/** TemporalValue 优先取精确时间，退化为 fallback 的下界；两者都没有则返回 null。 */
function temporalAt(value: EntryRevisionSnapshot["publishedAt"]): string | null {
    if (!value) {
        return null;
    }
    return value.exact ?? value.fallback?.lowerBound ?? null;
}

function timeValue(value: string | null): number {
    if (!value) {
        return 0;
    }
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
}

/**
 * 多来源 Story 的时间线：把每个来源成员的 Revision 与 Observation 展平成
 * 按时间倒序的事件流，来源名与事件类型分开表达，让用户能区分
 * “同一事件的多个来源”与“同一来源的多次修订”。
 */
export function buildStoryTimeline(story: StoryDetail): StoryTimelineEvent[] {
    const events: StoryTimelineEvent[] = [];
    for (const member of story.entries) {
        for (const revision of member.revisions) {
            events.push({
                id: `revision:${revision.id}`,
                at: temporalAt(revision.publishedAt) ?? revision.createdAt,
                kind: `来源修订 ${revision.revision}`,
                sourceName: member.sourceName,
                title: revision.title,
                detail: revision.contentKind,
            });
        }
        for (const observation of member.observations) {
            events.push({
                id: `observation:${observation.id}`,
                at: observation.capturedAt,
                kind: OBSERVATION_KINDS[observation.eventKind] ?? observation.eventKind,
                sourceName: member.sourceName,
                title: observation.webUrl ?? observation.externalKey,
                detail: null,
            });
        }
    }
    return events
        .toSorted((left, right) => timeValue(right.at) - timeValue(left.at))
        .slice(0, MAX_EVENTS);
}
