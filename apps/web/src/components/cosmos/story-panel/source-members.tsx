import type { StoryDetail } from "@cosmos/contracts";

import type { RelatedStory } from "@/lib/related-stories";

import { relationTypeLabel } from "./labels";

type Props = {
    story: StoryDetail;
    title: string;
    relatedStories: readonly RelatedStory[];
};

export function SourceMembersSection({ story, title, relatedStories }: Props) {
    return (
            <section aria-label="来源成员" className="border-b pb-4">
                <h3 className="font-medium">
                    来源成员（{story.entries.length}）
                </h3>
                {story.entries.length > 0 && (
                    <ul className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
                        {story.entries.map((member) => (
                            <li
                                key={member.id}
                                data-story-member-id={member.id}
                                className="flex flex-col"
                            >
                                <span className="truncate">
                                    {member.sourceName} ·{" "}
                                    {member.revisions[0]?.title ?? "无标题"} ·{" "}
                                    {member.id}
                                </span>
                                {member.relatedStories.length > 0 && (
                                    <span
                                        className="truncate text-xs"
                                        data-story-member-links={member.id}
                                    >
                                        作为{member.relatedStories
                                            .map((related) => relationTypeLabel(related.relationType))
                                            .join("、")}
                                        关联到：
                                        {member.relatedStories
                                            .map((related) => related.title)
                                            .join("、")}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </section>
    );
}
