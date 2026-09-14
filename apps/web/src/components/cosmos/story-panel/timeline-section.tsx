import {
    Badge,
} from "@/components/ui/badge";
import {
    type StoryTimelineEvent,
} from "@/lib/story-timeline";
import {
    formatTimelineDate,
} from "./labels";

export function TimelineSection({ events }: { events: readonly StoryTimelineEvent[] }) {
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
