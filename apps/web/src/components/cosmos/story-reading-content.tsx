import { useState } from "react";

import type { EntryRelationType, EntryStoryRelationType, StoryDetail } from "@cosmos/contracts";

import { messages } from "@/copy/messages";

import { EvidenceSection } from "./story-panel/evidence";
import { RelatedSection } from "./story-panel/related";
import { SplitOriginSection } from "./story-panel/split-origin";
import { RevisionAssets } from "./story-panel/revision-assets";
import { SourceMembersSection } from "./story-panel/source-members";
import { TimelineSection } from "./story-panel/timeline-section";
import type { StoryEntryOption } from "./story-panel/entry-option";
import type { RelatedStory } from "@/lib/related-stories";
import { buildStoryTimeline } from "@/lib/story-timeline";

/**
 * Story 阅读页左栏的**只读内容区块**：成员、证据、时间线、相关内容、媒体。
 *
 * 标题、摘要、正文与关键事实由阅读页自己渲染（它们是 `article` 卡片的一部分），
 * 这里只放卡片之后的区块，所以本组件不重复渲染它们。
 *
 * 判据是「它是不是这条内容本身」，不是「有没有写入控件」——成员行上的转载标记表单与
 * 证据来源的添加表单都留在这里，因为它们的对象就是这条 Story 的成员与证据，而且
 * `phase2-entry-relation.spec.ts` 依赖「成员行不用展开编辑面就在页面上」。
 * 会改写 Story 表示与编排的动作全部在右栏 `story-edit-panel`。
 */
type Props = {
    story: StoryDetail;
    /** 写动作进行中：成员行与证据来源的按钮据此禁用。 */
    busy: boolean;
    /** 证据关系候选条目（来自 GET /entries）；页面已排除本 Story 的成员。 */
    entryOptions?: readonly { id: string; title: string; sourceName: string }[];
    /** 关键事实出处候选：本 Story 的成员 + 全量已加载条目（ADR-0021 决定 3）。 */
    entryCandidates?: readonly StoryEntryOption[];
    onLinkEntry?: (input: { entryId: string; relationType: EntryStoryRelationType }) => Promise<void>;
    onUnlinkEntry?: (entryId: string) => Promise<void>;
    /** 条目↔条目重复/转载关系（ADR-0022）：成员行上标记、改类型与解除。 */
    onLinkEntryRelation?: (input: {
        fromEntryId: string;
        toEntryId: string;
        relationType: EntryRelationType;
    }) => Promise<void>;
    onUnlinkEntryRelation?: (input: {
        fromEntryId: string;
        toEntryId: string;
    }) => Promise<void>;
    /** 相关内容 v1（REC-008）：共享分类或共享实体的其它 Story，不是同一 Story。 */
    relatedStories?: readonly RelatedStory[];
    onOpenRelatedStory?: (storyId: string) => Promise<void>;
    /**
     * 证据来源的写入失败上报。左栏只读，但证据区块自带添加/解除表单，它们的错误
     * 由右栏持有的那一行错误提示统一显示（与拆分前的行为一致）。
     */
    onActionError?: (message: string | null) => void;
    setBusy?: (busy: boolean) => void;
};

export function StoryReadingContent({
    story,
    busy,
    entryOptions = [],
    entryCandidates,
    onLinkEntry,
    onUnlinkEntry,
    onLinkEntryRelation,
    onUnlinkEntryRelation,
    relatedStories = [],
    onOpenRelatedStory,
    onActionError,
    setBusy,
}: Props) {
    const [linkEntryId, setLinkEntryId] = useState("");
    const [linkRelationType, setLinkRelationType] =
        useState<EntryStoryRelationType>("evidence_for");

    const currentRevision = story.entry?.revisions[0];
    const timeline = buildStoryTimeline(story);

    /**
     * 成员行的来源标记按 Story 的 producer 取（ADR-0028）：一个 Story 的成员同属一次
     * 归并结果，不会出现成员之间写入者不同的情形。
     */
    const producers: Record<string, string | null> = {};
    for (const member of story.entries) {
        producers[member.id] = story.story.producer;
    }

    const submitLinkEntry = async (): Promise<void> => {
        if (!onLinkEntry || !linkEntryId) {
            return;
        }
        setBusy?.(true);
        onActionError?.(null);
        try {
            await onLinkEntry({ entryId: linkEntryId, relationType: linkRelationType });
            setLinkEntryId("");
        } catch (error) {
            onActionError?.(
                error instanceof Error ? error.message : messages.reading.storyEdit.linkEvidenceFailed,
            );
        } finally {
            setBusy?.(false);
        }
    };

    const submitUnlinkEntry = async (entryId: string): Promise<void> => {
        if (!onUnlinkEntry) {
            return;
        }
        setBusy?.(true);
        onActionError?.(null);
        try {
            await onUnlinkEntry(entryId);
        } catch (error) {
            onActionError?.(
                error instanceof Error ? error.message : messages.reading.storyEdit.unlinkEvidenceFailed,
            );
        } finally {
            setBusy?.(false);
        }
    };

    return (
        <div className="flex w-full min-w-0 flex-col gap-6" data-story-reading-content="true">
            <SourceMembersSection
                busy={busy}
                candidates={entryCandidates ?? []}
                onLinkEntryRelation={onLinkEntryRelation}
                onUnlinkEntryRelation={onUnlinkEntryRelation}
                producers={producers}
                story={story}
            />
            <EvidenceSection
                busy={busy}
                entryOptions={entryOptions}
                linkEntryId={linkEntryId}
                linkRelationType={linkRelationType}
                onLinkEntry={onLinkEntry}
                onUnlinkEntry={onUnlinkEntry}
                setLinkEntryId={setLinkEntryId}
                setLinkRelationType={setLinkRelationType}
                story={story}
                submitLinkEntry={submitLinkEntry}
                submitUnlinkEntry={submitUnlinkEntry}
                title={story.story.title}
            />
            <TimelineSection events={timeline} />
            <SplitOriginSection
                busy={busy}
                onOpenRelatedStory={onOpenRelatedStory}
                story={story}
            />
            <RelatedSection
                busy={busy}
                onOpenRelatedStory={onOpenRelatedStory}
                relatedStories={relatedStories}
                story={story}
                title={story.story.title}
            />
            <RevisionAssets assets={currentRevision?.assets ?? []} />
        </div>
    );
}
