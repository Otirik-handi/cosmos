import type { StoryDetail } from "@cosmos/contracts";

export type RelatedStory = {
    storyId: string;
    title: string;
    /** 相关性来源（共享分类/共享实体），展示出来避免用户误认为它们是同一个 Story。 */
    reason: string;
};

/** 读取端口由页面绑定到 Product API；单测用替身即可验证去重与上限。 */
export type RelatedStoryPorts = {
    searchByLabelIds: (labelIds: string) => Promise<readonly { storyId: string; title: string }[]>;
    entity: (entityId: string) => Promise<{ stories: readonly { storyId: string }[] }>;
    story: (storyId: string) => Promise<{ story: { title: string } }>;
};

const MAX_RELATED = 5;
const MAX_ENTITY_LINKS = 2;
const MAX_STORIES_PER_ENTITY = 2;

/**
 * 相关内容 v1（REC-008）：与本 Story 共享分类或共享 Entity 的其它 Story。
 * 只组合已有读合同、不做推荐排序，因此不会改变 Story 的权威关系；
 * 单个信号读取失败只丢该信号，辅助区块不能阻塞 Story 打开。
 */
export async function loadRelatedStories(
    detail: StoryDetail,
    ports: RelatedStoryPorts,
): Promise<RelatedStory[]> {
    const found = new Map<string, RelatedStory>();
    const add = (storyId: string, title: string, reason: string): void => {
        if (storyId === detail.story.id || found.has(storyId) || found.size >= MAX_RELATED) {
            return;
        }
        found.set(storyId, { storyId, title, reason });
    };

    if (detail.labels.length > 0) {
        const reason = `共享分类：${detail.labels.map((label) => label.name).join("、")}`;
        try {
            const items = await ports.searchByLabelIds(
                detail.labels.map((label) => label.id).join(","),
            );
            for (const item of items) {
                add(item.storyId, item.title, reason);
            }
        } catch {
            // 分类信号不可用时继续尝试实体信号。
        }
    }

    for (const link of detail.entities.slice(0, MAX_ENTITY_LINKS)) {
        if (found.size >= MAX_RELATED) {
            break;
        }
        try {
            const entityDetail = await ports.entity(link.entityId);
            for (const linked of entityDetail.stories.slice(0, MAX_STORIES_PER_ENTITY)) {
                if (found.has(linked.storyId) || found.size >= MAX_RELATED) {
                    continue;
                }
                try {
                    const linkedStory = await ports.story(linked.storyId);
                    add(linked.storyId, linkedStory.story.title, `共享实体：${link.name}`);
                } catch {
                    // 单条标题读取失败只跳过该条。
                }
            }
        } catch {
            // 单个实体读取失败只跳过该实体。
        }
    }

    return [...found.values()];
}
