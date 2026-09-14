import {
    useCallback,
    useState,
} from "react";
import {
    type Annotation,
    type TopicDetail,
    type TopicMemberRole,
    type TopicSummary,
    type UpdateTopicCommand,
} from "@cosmos/contracts";
import {
    client,
    readError,
} from "./page-runtime";
import type { WorkspaceContext } from "./page-bridge";
import type { useStoryWorkspace } from "./use-story-workspace";

type StoryApi = ReturnType<typeof useStoryWorkspace>;

/** 由 G06 切片 4 从 page.tsx 拆出的域 hook（搬运，未改行为）。 */
export function useTopicWorkspace(ctx: WorkspaceContext, storyApi: StoryApi) {
    const [topics, setTopics] = useState<readonly TopicSummary[]>([]);
    const [topic, setTopic] = useState<TopicDetail | null>(null);
    const [openingTopicId, setOpeningTopicId] = useState<string | null>(null);
    const [topicAnnotations, setTopicAnnotations] = useState<readonly Annotation[]>([]);
    const loadTopics = useCallback(async (): Promise<void> => {
        try {
            const page = await client.listTopics({ limit: 50 });
            setTopics(page.items);
        } catch {
            // 话题列表读取失败不阻断主 Feed；显式打开时才暴露错误。
        }
    }, []);

    const openTopic = async (topicId: string): Promise<void> => {
        setOpeningTopicId(topicId);
        ctx.setError(null);
        try {
            const topicDetail = await client.topic(topicId);
            const annotationList = await client.listAnnotations({
                targetType: "topic",
                targetId: topicDetail.topic.id,
            });
            setTopic(topicDetail);
            setTopicAnnotations(annotationList.items);
        } catch (caught) {
            ctx.setError(readError(caught));
        } finally {
            setOpeningTopicId(null);
        }
    };

    const updateTopic = async (command: UpdateTopicCommand): Promise<void> => {
        if (!topic) {
            return;
        }
        const updated = await client.updateTopic(topic.topic.id, command);
        setTopic(updated);
        await loadTopics();
    };

    const updateTopicMemberRole = async (
        storyId: string,
        role: TopicMemberRole,
    ): Promise<void> => {
        if (!topic) {
            return;
        }
        const updated = await client.updateTopicMemberRole(topic.topic.id, {
            storyId,
            role,
        });
        setTopic(updated);
    };

    const removeTopicMember = async (storyId: string): Promise<void> => {
        if (!topic) {
            return;
        }
        const updated = await client.removeTopicMember(topic.topic.id, { storyId });
        setTopic(updated);
    };

    const restoreTopicMember = async (
        storyId: string,
        role: TopicMemberRole,
    ): Promise<void> => {
        if (!topic) {
            return;
        }
        const updated = await client.restoreTopicMember(topic.topic.id, {
            storyId,
            role,
        });
        setTopic(updated);
    };

    const refreshTopicAnnotations = async (): Promise<void> => {
        if (!topic) {
            return;
        }
        const list = await client.listAnnotations({
            targetType: "topic",
            targetId: topic.topic.id,
        });
        setTopicAnnotations(list.items);
    };

    const createTopicAnnotation = async (input: {
        body: string;
        quote?: string | null;
    }): Promise<void> => {
        if (!topic) {
            return;
        }
        await client.createAnnotation({
            targetType: "topic",
            targetId: topic.topic.id,
            body: input.body,
            quote: input.quote ?? null,
        });
        ctx.setNotice("已添加批注。");
        await refreshTopicAnnotations();
    };

    const updateTopicAnnotation = async (
        annotationId: string,
        input: { body: string; quote?: string | null },
    ): Promise<void> => {
        if (!topic) {
            return;
        }
        await client.updateAnnotation(annotationId, {
            body: input.body,
            quote: input.quote ?? null,
        });
        ctx.setNotice("已更新批注。");
        await refreshTopicAnnotations();
    };

    const deleteTopicAnnotation = async (annotationId: string): Promise<void> => {
        if (!topic) {
            return;
        }
        await client.deleteAnnotation(annotationId);
        ctx.setNotice("已删除批注。");
        await refreshTopicAnnotations();
    };

    const joinTopic = async (topicId: string, role: TopicMemberRole): Promise<void> => {
        if (!storyApi.story) {
            return;
        }
        await client.addTopicMember(topicId, {
            storyId: storyApi.story.story.id,
            role,
        });
        await loadTopics();
    };

    const createTopicFromStory = async (title: string, purpose: string): Promise<void> => {
        if (!storyApi.story) {
            return;
        }
        await client.createTopic({
            title,
            purpose,
            seedStoryId: storyApi.story.story.id,
        });
        ctx.setNotice(`已创建 Topic「${title}」并把当前 Story 加入为核心成员。`);
        await loadTopics();
    };


    return {
        createTopicAnnotation,
        createTopicFromStory,
        deleteTopicAnnotation,
        joinTopic,
        loadTopics,
        openTopic,
        openingTopicId,
        removeTopicMember,
        restoreTopicMember,
        setTopic,
        topic,
        topicAnnotations,
        topics,
        updateTopic,
        updateTopicAnnotation,
        updateTopicMemberRole,
    };
}
