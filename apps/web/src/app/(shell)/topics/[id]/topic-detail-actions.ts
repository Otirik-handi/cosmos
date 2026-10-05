"use client";

import type { TopicDetail, TopicMemberRole } from "@cosmos/contracts";
import { CosmosTransportError } from "@cosmos/transport-http";

import type { Notify } from "@/app/home/page-bridge";
import { readError } from "@/app/home/page-runtime";
import type { useTopicWorkspace } from "@/app/home/use-topic-workspace";

import { messages } from "@/copy/messages";

type TopicApi = ReturnType<typeof useTopicWorkspace>;

/**
 * 详情页的四个写动作：发命令 → 用回执里的新详情覆盖状态（`useTopicWorkspace` 内部做）→
 * 界面直接显示服务端结果，不需要再补一次读取。
 *
 * 失败在这里归一到页面横幅；**版本冲突单独处理**：用户的草稿基于旧版本，只报错会让人
 * 对着读不到的旧值反复重试，所以先重读、再让用户重试。
 *
 * 抽成独立模块只为让页面组件留在代码规模红线内（单函数 ≤100 行），不引入新状态。
 */
export function createTopicDetailActions(input: {
    topicApi: TopicApi;
    topic: TopicDetail | null;
    setError: Notify;
    reload: () => Promise<void>;
}) {
    const { topicApi, topic, setError, reload } = input;

    const saveFields = async (draft: { title: string; purpose: string }): Promise<boolean> => {
        if (topic === null) {
            return false;
        }
        setError(null);
        try {
            await topicApi.updateTopic({
                baseRevisionId: topic.topic.revisionId,
                title: draft.title,
                purpose: draft.purpose,
                scope: topic.topic.scope,
            });
            return true;
        } catch (caught) {
            if (isVersionConflict(caught)) {
                setError(messages.pages.topics.detail.versionConflict);
                await reload();
            } else {
                setError(failureMessage(messages.pages.topics.detail.saveFailed, caught));
            }
            return false;
        }
    };

    const changeMemberRole = async (storyId: string, role: TopicMemberRole): Promise<void> => {
        setError(null);
        try {
            await topicApi.updateTopicMemberRole(storyId, role);
        } catch (caught) {
            setError(failureMessage(messages.pages.topics.detail.roleChangeFailed, caught));
        }
    };

    const removeMember = async (storyId: string): Promise<void> => {
        setError(null);
        try {
            await topicApi.removeTopicMember(storyId);
        } catch (caught) {
            setError(failureMessage(messages.pages.topics.detail.memberRemoveFailed, caught));
        }
    };

    const restoreMember = async (storyId: string, role: TopicMemberRole): Promise<void> => {
        setError(null);
        try {
            await topicApi.restoreTopicMember(storyId, role);
        } catch (caught) {
            setError(failureMessage(messages.pages.topics.detail.memberRestoreFailed, caught));
        }
    };

    return { changeMemberRole, removeMember, restoreMember, saveFields };
}

/** 动作失败在横幅里只有一行，把「什么动作失败了」与 transport 的错误原文拼起来。 */
function failureMessage(prefix: string, caught: unknown): string {
    return `${prefix}${readError(caught)}`;
}

function isVersionConflict(caught: unknown): boolean {
    return caught instanceof CosmosTransportError && caught.status === 409;
}
