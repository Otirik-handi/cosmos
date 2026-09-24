import type { StoryDetail } from "@cosmos/contracts";

import { Badge } from "@/components/ui/badge";
import { keyFactSourceLabel, storyEventTimeView } from "@/lib/story-event-time";

import type { StoryEntryOption } from "./entry-option";

/** 详情标题下的事件时间；按精度显示，只有原文时标注不精确（ADR-0021 决定 2）。 */
export function StoryEventTimeLine({ story }: { story: StoryDetail }) {
    const view = storyEventTimeView(story.story.timeRange);
    if (!view) {
        return null;
    }
    return (
        <p
            data-story-event-time="true"
            className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
        >
            <span className="font-medium text-foreground">事件时间</span>
            <span>{view.text}</span>
            {view.uncertain && <Badge variant="outline">不精确</Badge>}
        </p>
    );
}

type KeyFactsProps = {
    entryOptions: readonly StoryEntryOption[];
    story: StoryDetail;
};

/**
 * The ingest projection freezes a Story whose current Revision is human-written
 * (ADR-0028). Without saying so the Story just looks stale, so the freeze is
 * stated where the representation is read.
 */
export function StoryHumanProtectedNotice({ story }: { story: StoryDetail }) {
    if (story.story.producer !== "human") {
        return null;
    }
    return (
        <p
            data-story-human-protected="true"
            className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
        >
            <Badge variant="outline">人工已修改</Badge>
            <span>自动更新已暂停，来源的新版本不会覆盖这里的内容。</span>
        </p>
    );
}

/** 关键事实按保存顺序列出，每条显示出处；出处指向的信息条目已不存在时如实标出。 */
export function StoryKeyFactsBlock({ entryOptions, story }: KeyFactsProps) {
    const keyFacts = story.story.keyFacts ?? [];
    return (
        <section aria-label="关键事实" data-story-key-facts="true" className="border-t pt-4">
            <h3 className="font-medium">关键事实（{keyFacts.length}）</h3>
            {keyFacts.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">还没有关键事实。</p>
            ) : (
                <ol className="mt-2 grid list-decimal gap-2 pl-5 text-sm leading-6">
                    {keyFacts.map((fact, index) => {
                        const source = keyFactSourceLabel(fact, entryOptions);
                        return (
                            <li key={index} data-story-key-fact-index={index}>
                                <span>{fact.text}</span>
                                {source !== null && (
                                    <span className="ml-2 text-xs text-muted-foreground">
                                        出处：{source}
                                    </span>
                                )}
                            </li>
                        );
                    })}
                </ol>
            )}
        </section>
    );
}
