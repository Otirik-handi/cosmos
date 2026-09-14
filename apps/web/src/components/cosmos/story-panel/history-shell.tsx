import type { StoryDetail } from "@cosmos/contracts";

type Props = {
    busy: boolean;
    kind: StoryDetail["story"]["kind"];
    onOpenRelatedStory?: (storyId: string) => Promise<void>;
    story: StoryDetail;
    title: string;
};

export function HistoryShellSection({ busy, kind, onOpenRelatedStory, story, title }: Props) {
    return (
                <section
                    aria-label="历史壳"
                    className="border-b pb-4"
                    data-story-shell="true"
                >
                    <h3 className="font-medium">
                        历史壳（后继 {story.story.replacedBy.length}）
                    </h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                        本条 Story 已被拆分；它的成员历史、批注与审计仍然保留在这里，但不再接受归并、改标题或再次拆分。
                    </p>
                    <ul className="mt-2 grid gap-2">
                        {story.story.replacedBy.map((successor) => (
                            <li
                                key={successor.storyId}
                                className="flex flex-col gap-0.5 rounded-sm border bg-muted/40 px-3 py-2"
                            >
                                <button
                                    type="button"
                                    disabled={!onOpenRelatedStory || busy}
                                    onClick={() => {
                                        if (onOpenRelatedStory) {
                                            void onOpenRelatedStory(successor.storyId);
                                        }
                                    }}
                                    className="rounded-sm text-left text-sm hover:text-primary focus-visible:border-ring focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none disabled:opacity-60"
                                    data-story-successor-id={successor.storyId}
                                >
                                    {successor.title}
                                </button>
                                <span className="text-xs text-muted-foreground">
                                    {successor.kind} · {successor.storyId}
                                </span>
                            </li>
                        ))}
                    </ul>
                </section>
    );
}
