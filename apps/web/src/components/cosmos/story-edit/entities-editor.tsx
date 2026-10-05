import type { EntitySummary, StoryDetail, TopicMemberRole, TopicSummary } from "@cosmos/contracts";
import { useState } from "react";

import { StoryLinkEntitySection } from "@/components/cosmos/story-panel/link-entity";
import { StoryTopicSection } from "@/components/cosmos/story-panel/topic-join";
import { Separator } from "@/components/ui/separator";
import { messages } from "@/copy/messages";

/**
 * 「对象关联」段（D 段）：关联 Entity、加入 Topic。
 *
 * 判据是「把这条 Story 挂到别的已有对象上」——改的是关系表，两端都是已经存在的对象
 * （创建 Entity/Topic 都在各自的对象页，ADR-0029 决策 1）。它与 C 段「我的标记」原本共用
 * 一个 `StoryOrganizationEditor`，那个容器同时装着标记与关联两类东西的状态；
 * Task 36 Round 9 按类别重排右栏时拆开，两段各自持有自己的草稿。
 *
 * 草稿（选中的 Entity、选中的 Topic 与角色）只在本段内使用；busy 与错误行仍由
 * `StoryEditPanel` 持有，四段共用一行提示。
 */
type Props = {
    story: StoryDetail;
    busy: boolean;
    setBusy: (value: boolean) => void;
    setActionError: (value: string | null) => void;
    entityOptions?: readonly EntitySummary[];
    onLinkEntity?: (entityId: string) => Promise<void>;
    onUnlinkEntity?: (entityId: string) => Promise<void>;
    topics?: readonly TopicSummary[];
    onJoinTopic?: (topicId: string, role: TopicMemberRole) => Promise<void>;
};

export function StoryEntitiesEditor({
    story,
    busy,
    setBusy,
    setActionError,
    entityOptions,
    onLinkEntity,
    onUnlinkEntity,
    topics,
    onJoinTopic,
}: Props) {
    const [linkEntityId, setLinkEntityId] = useState("");
    const [joinTopicId, setJoinTopicId] = useState("");
    const [joinRole, setJoinRole] = useState<TopicMemberRole>("core");

    /** 两个写入共用一条漏斗：置 busy、清错误、失败落到共用的错误行。 */
    const runAction = async (action: () => Promise<void>): Promise<void> => {
        setBusy(true);
        setActionError(null);
        try {
            await action();
        } catch (error) {
            setActionError(error instanceof Error ? error.message : messages.reading.storyEdit.entities.actionFailed);
        } finally {
            setBusy(false);
        }
    };

    const submitLinkEntity = async (): Promise<void> => {
        if (!onLinkEntity || !linkEntityId) {
            return;
        }
        await runAction(async () => {
            await onLinkEntity(linkEntityId);
            setLinkEntityId("");
        });
    };

    const submitUnlinkEntity = async (entityId: string): Promise<void> => {
        if (!onUnlinkEntity) {
            return;
        }
        await runAction(() => onUnlinkEntity(entityId));
    };

    const submitJoinTopic = async (): Promise<void> => {
        if (!onJoinTopic || !joinTopicId) {
            return;
        }
        await runAction(async () => {
            await onJoinTopic(joinTopicId, joinRole);
            setJoinTopicId("");
        });
    };

    return (
        <div className="flex flex-col gap-5">
            <StoryLinkEntitySection
                busy={busy}
                entityOptions={entityOptions}
                linkEntityId={linkEntityId}
                setLinkEntityId={setLinkEntityId}
                story={story}
                submitLinkEntity={submitLinkEntity}
                submitUnlinkEntity={submitUnlinkEntity}
            />
            <Separator decorative />
            <StoryTopicSection
                busy={busy}
                joinRole={joinRole}
                joinTopicId={joinTopicId}
                setJoinRole={setJoinRole}
                setJoinTopicId={setJoinTopicId}
                submitJoinTopic={submitJoinTopic}
                topics={topics}
            />
        </div>
    );
}
