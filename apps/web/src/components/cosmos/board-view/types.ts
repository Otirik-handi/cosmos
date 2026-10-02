import type { ReactNode } from "react";

import type {
    BoardDetail,
    CollectionSummary,
    SavedView,
    TopicSummary,
} from "@cosmos/contracts";
import type { HttpCosmosClient } from "@cosmos/transport-http";


export type BoardCommands = {
    createSection: (title: string) => Promise<void>;
    updateSection: (sectionId: string, input: { title: string; position?: number }) => Promise<void>;
    deleteSection: (sectionId: string) => Promise<void>;
    createBlock: (
        sectionId: string,
        type: string,
        config: Record<string, unknown>,
    ) => Promise<void>;
    updateBlockConfig: (blockId: string, config: Record<string, unknown>) => Promise<void>;
    deleteBlock: (blockId: string) => Promise<void>;
    moveBlock: (blockId: string, sectionId: string, position: number) => Promise<void>;
    setBlockVisibility: (blockId: string, visible: boolean) => Promise<void>;
    duplicateBlock: (blockId: string) => Promise<void>;
};

export type BoardViewProps = {
    board: BoardDetail;
    client: HttpCosmosClient;
    /** 采集计划区块复用页面的计划列表（含启用/停用/手动录入操作）。 */
    planListSlot: ReactNode;
    topics: readonly TopicSummary[];
    openingTopicId: string | null;
    onOpenTopic: (topicId: string) => void;
    onOpenStory: (storyId: string) => void;
    /** 编辑模式：显示分区/区块的增删改与排序控件（ADR-0010 决定 1）。 */
    editable?: boolean;
    commands?: BoardCommands;
    savedViews?: readonly SavedView[];
    collections?: readonly CollectionSummary[];
    /** 自取数区块（Spotlight）的刷新信号；pin 之后由页面递增。 */
    refreshToken?: number;
};
