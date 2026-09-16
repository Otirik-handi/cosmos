import type { BoardDetail } from "@cosmos/contracts";

/**
 * 拖拽落点解析。
 *
 * 唯一真相是 dnd-kit 的 `over`——拖动过程中"其他区块让位"的预览就是按它算的，
 * 因此提交也必须用同一个结果，才能保证「松手的结果 = 刚才看到的预览」。
 * 曾经的实现改成用指针几何（离哪个区块中心最近）自己再算一遍，于是同一动作出现
 * 两套判定：预览显示 [A,C,B,D]，落库却是 [A,C,D,B]；向上拖时指针靠近原位置还会
 * 算成 no-op（看起来"拖不动"）。别再把几何判定加回来。
 *
 * `position` 用 arrayMove 语义（把被拖区块移到目标区块当前所在的下标），这与服务端
 * `moveBlock` 的"先移除被拖区块、再在剩余区块之间插入"口径等价（见 `applyLocalMove`）。
 */
export type BlockDropTarget = {
    blockId: string;
    sectionId: string;
    position: number;
};

export type BlockLocation = {
    sectionId: string;
    index: number;
};

export function findBlock(board: BoardDetail, blockId: string): BlockLocation | null {
    for (const section of board.sections) {
        const index = section.blocks.findIndex((block) => block.id === blockId);
        if (index !== -1) {
            return { sectionId: section.id, index };
        }
    }
    return null;
}

/** 把「拖到了哪个区块上」翻译成 `moveBlock` 的参数；原地不动或未知区块返回 null。 */
export function resolveDropTarget(
    board: BoardDetail,
    activeId: string,
    overId: string,
): BlockDropTarget | null {
    if (activeId === overId) {
        return null;
    }
    const over = findBlock(board, overId);
    if (!over) {
        return null;
    }
    return { blockId: activeId, sectionId: over.sectionId, position: over.index };
}

/**
 * 在本地把同一次移动应用到看板树上，供松手后立即渲染（乐观更新）。
 *
 * 必须与服务端 `moveBlock` 的语义一致：从原分区摘掉、按 `position` 插进目标分区、
 * 两个分区的 `position` 重排成连续值。只要两边一致，松手后的本地结果就与随后返回的
 * 服务端结果相同，不会出现"先跳回旧顺序再跳到新顺序"的闪烁。
 * 未知区块或未知目标分区时原样返回，不做任何改动。
 */
export function applyLocalMove(
    board: BoardDetail,
    blockId: string,
    sectionId: string | null,
    position: number,
): BoardDetail {
    const from = findBlock(board, blockId);
    if (!from) {
        return board;
    }
    const targetSectionId = sectionId ?? from.sectionId;
    if (!board.sections.some((section) => section.id === targetSectionId)) {
        return board;
    }
    const dragged = board.sections
        .find((section) => section.id === from.sectionId)
        ?.blocks.find((block) => block.id === blockId);
    if (!dragged) {
        return board;
    }
    const sections = board.sections.map((section) => {
        const remaining = section.blocks.filter((block) => block.id !== blockId);
        if (section.id === targetSectionId) {
            const insertAt = Math.min(Math.max(position, 0), remaining.length);
            const next = [
                ...remaining.slice(0, insertAt),
                dragged,
                ...remaining.slice(insertAt),
            ];
            return {
                ...section,
                blocks: next.map((block, index) => ({
                    ...block,
                    sectionId: section.id,
                    position: index,
                })),
            };
        }
        if (section.id === from.sectionId) {
            return {
                ...section,
                blocks: remaining.map((block, index) => ({ ...block, position: index })),
            };
        }
        return section;
    });
    return { ...board, sections };
}
