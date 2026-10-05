import type { StoryDetail } from "@cosmos/contracts";

import { messages } from "@/copy/messages";

type Props = {
    busy: boolean;
    onOpenRelatedStory?: (storyId: string) => Promise<void>;
    story: StoryDetail;
};

/**
 * 拆分来源回链：这条内容是从哪条内容拆出来的。
 *
 * 存在的理由是可找回性（维护者 2026-10-05 验收）：拆成空壳的原条没有任何成员，
 * 因此没有 entry 投影、不会出现在信息库或看板里；而按 ADR-0020，批注、标签、收藏
 * 这些用户状态**留在原条上不自动扇出**。没有这条回链，那些状态就只能靠记住 URL 才能找到。
 *
 * 只读展示，不提供写操作——迁移用户状态仍在原条页面上做（ADR-0020 决定 7：
 * 迁移是历史壳上唯一允许的写操作）。
 */
export function SplitOriginSection({ busy, onOpenRelatedStory, story }: Props) {
    const origin = story.story.splitFrom;
    if (origin === null) {
        return null;
    }
    return (
        <section aria-label={messages.reading.splitOrigin.label} className="flex flex-col gap-2">
            <h3 className="font-medium">
                {messages.reading.splitOrigin.label}
            </h3>
            <ul className="grid gap-2" data-story-split-origin="true">
                <li className="flex flex-col gap-0.5 rounded-sm border bg-muted/40 px-3 py-2">
                    <button
                        type="button"
                        disabled={!onOpenRelatedStory || busy}
                        onClick={() => {
                            if (onOpenRelatedStory) {
                                void onOpenRelatedStory(origin.storyId);
                            }
                        }}
                        className="rounded-sm text-left text-sm hover:text-primary focus-visible:border-ring focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none disabled:opacity-60"
                        data-story-split-origin-id={origin.storyId}
                    >
                        {origin.title}
                    </button>
                    <span className="text-xs text-muted-foreground">
                        {messages.reading.splitOrigin.hint}
                    </span>
                </li>
            </ul>
        </section>
    );
}
