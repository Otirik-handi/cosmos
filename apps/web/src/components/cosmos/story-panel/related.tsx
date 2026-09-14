import type { StoryDetail } from "@cosmos/contracts";

import type { RelatedStory } from "@/lib/related-stories";

type Props = {
    busy: boolean;
    onOpenRelatedStory?: (storyId: string) => Promise<void>;
    relatedStories: readonly RelatedStory[];
    story: StoryDetail;
    title: string;
};

export function RelatedSection({ busy, onOpenRelatedStory, relatedStories, story, title }: Props) {
    return (
            <section aria-label="相关内容" className="border-b pb-4">
                <h3 className="font-medium">相关内容（{relatedStories.length}）</h3>
                {relatedStories.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                        暂无相关但不同事件的 Story；给本条 Story 添加分类或关联 Entity 后会自动出现。
                    </p>
                ) : (
                    <ul className="mt-2 grid gap-2" data-story-related="true">
                        {relatedStories.map((item) => (
                            <li
                                key={item.storyId}
                                className="flex flex-col gap-0.5 rounded-sm border bg-muted/40 px-3 py-2"
                            >
                                <button
                                    type="button"
                                    disabled={!onOpenRelatedStory || busy}
                                    onClick={() => {
                                        if (onOpenRelatedStory) {
                                            void onOpenRelatedStory(item.storyId);
                                        }
                                    }}
                                    className="rounded-sm text-left text-sm hover:text-primary focus-visible:border-ring focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none disabled:opacity-60"
                                >
                                    {item.title}
                                </button>
                                <span className="text-xs text-muted-foreground">
                                    {item.reason} · {item.storyId}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
    );
}
