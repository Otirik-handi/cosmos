import {
    useState,
} from "react";
import {
    type BoardDetail,
    type BoardSummary,
} from "@cosmos/contracts";
import {
    type BoardCommands,
} from "@/components/cosmos/board-view";
import {
    client,
    readError,
} from "./page-runtime";
import type { WorkspaceContext } from "./page-bridge";
import type { useStoryWorkspace } from "./use-story-workspace";
import type { useTopicWorkspace } from "./use-topic-workspace";

type StoryApi = ReturnType<typeof useStoryWorkspace>;
type TopicApi = ReturnType<typeof useTopicWorkspace>;

/** 由 G06 切片 4 从 page.tsx 拆出的域 hook（搬运，未改行为）。 */
export function useBoardWorkspace(ctx: WorkspaceContext, storyApi: StoryApi, topicApi: TopicApi) {
    const [board, setBoard] = useState<BoardDetail | null>(null);
    const [boards, setBoards] = useState<readonly BoardSummary[]>([]);
    const [boardEditing, setBoardEditing] = useState(false);
    const [boardRefreshToken, setBoardRefreshToken] = useState(0);
    const [newBoardName, setNewBoardName] = useState("");
    const reloadBoards = async (): Promise<void> => {
        setBoards((await client.listBoards()).items);
    };

    /** 看板写命令统一用返回的树刷新当前 Board，保证顺序/可见性与服务端一致。 */
    const boardCommands: BoardCommands = {
        createSection: async (title) => {
            if (!board) {
                return;
            }
            setBoard(await client.createBoardSection({ boardId: board.id, title }));
            await reloadBoards();
        },
        updateSection: async (sectionId, input) => {
            setBoard(await client.updateBoardSection(sectionId, input));
        },
        deleteSection: async (sectionId) => {
            await client.deleteBoardSection(sectionId);
            if (board) {
                setBoard(await client.getBoard(board.id));
                await reloadBoards();
            }
        },
        createBlock: async (sectionId, type, config) => {
            setBoard(await client.createBoardBlock({
                sectionId,
                type: type as Parameters<typeof client.createBoardBlock>[0]["type"],
                config,
            }));
        },
        updateBlockConfig: async (blockId, config) => {
            setBoard(await client.updateBoardBlockConfig(blockId, { config }));
        },
        deleteBlock: async (blockId) => {
            await client.deleteBoardBlock(blockId);
            if (board) {
                setBoard(await client.getBoard(board.id));
            }
        },
        moveBlock: async (blockId, sectionId, position) => {
            setBoard(await client.moveBoardBlock(blockId, { sectionId, position }));
        },
        setBlockVisibility: async (blockId, visible) => {
            setBoard(await client.setBoardBlockVisibility(blockId, { visible }));
        },
        duplicateBlock: async (blockId) => {
            setBoard(await client.duplicateBoardBlock(blockId));
        },
    };

    const switchBoard = async (boardId: string): Promise<void> => {
        ctx.setError(null);
        try {
            setBoard(await client.getBoard(boardId));
            setBoardEditing(false);
        } catch (caught) {
            ctx.setError(readError(caught));
        }
    };

    const createBoard = async (name: string): Promise<void> => {
        const trimmed = name.trim();
        if (trimmed === "") {
            return;
        }
        ctx.setError(null);
        try {
            setBoard(await client.createBoard({ name: trimmed }));
            await reloadBoards();
            setBoardEditing(true);
            ctx.setNotice(`已创建看板「${trimmed}」，可在编辑模式添加分区与区块。`);
        } catch (caught) {
            ctx.setError(readError(caught));
        }
    };

    /** 把当前 Story/Topic 固定到当前看板热点区（Spotlight 人工固定，ADR-0010）。 */
    const pinToBoard = async (
        targetType: "story" | "topic",
        targetId: string,
    ): Promise<void> => {
        if (!board) {
            ctx.setError("看板尚未加载，无法固定。");
            return;
        }
        ctx.setError(null);
        try {
            await client.pinSpotlight({ boardId: board.id, targetType, targetId });
            setBoardRefreshToken((token) => token + 1);
            ctx.setNotice("已固定到看板热点区。");
        } catch (caught) {
            ctx.setError(readError(caught));
        }
    };


    return {
        board,
        boardCommands,
        boardEditing,
        boardRefreshToken,
        boards,
        createBoard,
        newBoardName,
        pinToBoard,
        setBoard,
        setBoardEditing,
        setBoards,
        setNewBoardName,
        switchBoard,
    };
}
