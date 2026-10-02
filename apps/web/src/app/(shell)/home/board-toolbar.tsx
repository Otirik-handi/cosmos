import type {
    BoardDetail,
    BoardSummary,
} from "@cosmos/contracts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { messages } from "@/copy/messages";

/**
 * 首页看板控制条：切换看板、进出编辑模式、新建看板。
 *
 * 这里**没有**「新建计划」：来源与计划的创建入口只在 `/automation`（ADR-0029 决策 1
 * 「首页负责看、创建去对象页」）。首页保留的是看板的 `采集计划` 区块本身，那属于看板内容。
 */
export function HomeBoardToolbar({
    boards,
    board,
    boardEditing,
    createBoard,
    newBoardName,
    setBoardEditing,
    setNewBoardName,
    switchBoard,
}: {
    boards: readonly BoardSummary[];
    board: BoardDetail | null;
    boardEditing: boolean;
    createBoard: (name: string) => Promise<void>;
    newBoardName: string;
    setBoardEditing: (update: (value: boolean) => boolean) => void;
    setNewBoardName: (value: string) => void;
    switchBoard: (boardId: string) => Promise<void>;
}) {
    return (

            <div className="flex flex-wrap items-center gap-2">
                {boards.length > 0 && (
                    <>
                        <label className="flex items-center gap-2 text-[13px]">
                            <span className="text-muted-foreground">{messages.home.boardLabel}</span>
                            <select
                                aria-label={messages.home.switchBoard}
                                className="h-8 rounded-[var(--radius-control)] border border-input bg-card px-2 text-[13px]"
                                value={board?.id ?? ""}
                                onChange={(event) => void switchBoard(event.target.value)}
                            >
                                {boards.map((item) => (
                                    <option key={item.id} value={item.id}>
                                        {item.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <Button
                            variant="outline"
                            onClick={() => setBoardEditing((value) => !value)}
                        >
                            {boardEditing ? messages.home.finishEditing : messages.home.editBoard}
                        </Button>
                        {boardEditing && (
                            <>
                                <Input
                                    aria-label={messages.home.newBoardName}
                                    className="max-w-xs"
                                    placeholder={messages.home.newBoardName}
                                    value={newBoardName}
                                    onChange={(event) => setNewBoardName(event.target.value)}
                                />
                                <Button
                                    variant="outline"
                                    disabled={newBoardName.trim() === ""}
                                    onClick={() => {
                                        const name = newBoardName;
                                        setNewBoardName("");
                                        void createBoard(name);
                                    }}
                                >
                                    {messages.home.createBoard}
                                </Button>
                            </>
                        )}
                    </>
                )}
            </div>
    );
}
