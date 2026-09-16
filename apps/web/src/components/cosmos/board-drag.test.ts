import { describe, expect, it } from "vitest";

import type { BoardBlock, BoardDetail } from "@cosmos/contracts";

import { applyLocalMove, findBlock, resolveDropTarget } from "./board-drag";

const timestamp = "2026-09-15T00:00:00.000Z";

function block(
    id: string,
    sectionId: string,
    type: string,
    position: number,
    visible = true,
): BoardBlock {
    return {
        id,
        sectionId,
        type,
        config: {},
        position,
        visible,
        createdAt: timestamp,
        updatedAt: timestamp,
    };
}

function section(
    id: string,
    title: string,
    position: number,
    blocks: readonly BoardBlock[],
): BoardDetail["sections"][number] {
    return { id, boardId: "board-1", title, position, blocks: [...blocks], createdAt: timestamp, updatedAt: timestamp };
}

/** 分区一依次为 A/B/C/D，分区二只有 X。 */
function boardFixture(): BoardDetail {
    return {
        id: "board-1",
        name: "默认看板",
        description: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        sections: [
            section("s1", "分区一", 0, [
                block("A", "s1", "feed", 0),
                block("B", "s1", "collection", 1),
                block("C", "s1", "collection", 2),
                block("D", "s1", "collection", 3),
            ]),
            section("s2", "分区二", 1, [block("X", "s2", "spotlight", 0)]),
        ],
    };
}

function orderOf(board: BoardDetail, sectionId: string): string[] {
    return board.sections.find((entry) => entry.id === sectionId)?.blocks.map((entry) => entry.id) ?? [];
}

function positionsOf(board: BoardDetail, sectionId: string): number[] {
    return board.sections.find((entry) => entry.id === sectionId)?.blocks.map((entry) => entry.position) ?? [];
}

/** dnd-kit 预览的语义：把 from 处的元素移到 to 处（这就是用户拖动时看到的结果）。 */
function arrayMove(ids: readonly string[], from: number, to: number): string[] {
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    return next;
}

/** 走一次完整链路：落点解析 → 本地落定。 */
function moveByOver(board: BoardDetail, activeId: string, overId: string): BoardDetail {
    const target = resolveDropTarget(board, activeId, overId);
    if (!target) {
        return board;
    }
    return applyLocalMove(board, target.blockId, target.sectionId, target.position);
}

describe("findBlock", () => {
    it("locates a block with its section and array index", () => {
        expect(findBlock(boardFixture(), "C")).toEqual({ sectionId: "s1", index: 2 });
    });

    it("returns null for an unknown block", () => {
        expect(findBlock(boardFixture(), "missing")).toBeNull();
    });
});

describe("resolveDropTarget", () => {
    it("targets the dropped-on block's index so the result equals the drag preview", () => {
        // B 拖到 C 上：预览是 [A,C,B,D]（B 落到 C 原来的位置）。
        expect(resolveDropTarget(boardFixture(), "B", "C")).toEqual({
            blockId: "B",
            sectionId: "s1",
            position: 2,
        });
    });

    it("targets index 0 when dropped on the first block", () => {
        expect(resolveDropTarget(boardFixture(), "B", "A")).toEqual({
            blockId: "B",
            sectionId: "s1",
            position: 0,
        });
    });

    it("crosses into the target block's section", () => {
        expect(resolveDropTarget(boardFixture(), "A", "X")).toEqual({
            blockId: "A",
            sectionId: "s2",
            position: 0,
        });
    });

    it("counts hidden blocks, because edit mode renders them in place", () => {
        const board = boardFixture();
        board.sections[0]!.blocks[2]!.visible = false;
        // 隐藏的 C 仍占数组下标 2，拖 B 到 C 上得到 [A,C,B,D]。
        expect(resolveDropTarget(board, "B", "C")).toEqual({
            blockId: "B",
            sectionId: "s1",
            position: 2,
        });
    });

    it("returns null when nothing moved or the target is unknown", () => {
        expect(resolveDropTarget(boardFixture(), "B", "B")).toBeNull();
        expect(resolveDropTarget(boardFixture(), "B", "missing")).toBeNull();
    });
});

describe("applying a drop matches the drag preview", () => {
    // 拖动期间"其他区块让位"的预览就是 arrayMove；提交必须得到同一个顺序，否则会出现
    // 「预览 [A,C,B,D]、落库 [A,C,D,B]」这类分叉。
    it("reproduces the preview for every drop target", () => {
        const ids = ["A", "B", "C", "D"];
        for (const activeId of ids) {
            for (const overId of ids) {
                if (activeId === overId) {
                    continue;
                }
                const from = ids.indexOf(activeId);
                const to = ids.indexOf(overId);
                expect(orderOf(moveByOver(boardFixture(), activeId, overId), "s1")).toEqual(
                    arrayMove(ids, from, to),
                );
            }
        }
    });

    it("lands B right below C when B is dropped on C", () => {
        // 维护者实测：拖 B 向下、指针靠近 D 时落库成了 [A,C,D,B]，预览却是 [A,C,B,D]。
        expect(orderOf(moveByOver(boardFixture(), "B", "C"), "s1")).toEqual(["A", "C", "B", "D"]);
    });

    it("moves B above A when B is dropped on A", () => {
        // 维护者实测：拖 B 向上、指针靠近原位置时算成 no-op（看起来"拖不动"）。
        const moved = moveByOver(boardFixture(), "B", "A");
        expect(orderOf(moved, "s1")).toEqual(["B", "A", "C", "D"]);
    });
});

describe("applyLocalMove", () => {
    it("re-sequences positions after a move inside a section", () => {
        const moved = applyLocalMove(boardFixture(), "B", "s1", 2);
        expect(orderOf(moved, "s1")).toEqual(["A", "C", "B", "D"]);
        expect(positionsOf(moved, "s1")).toEqual([0, 1, 2, 3]);
    });

    it("moves a block across sections and re-sequences both", () => {
        const moved = applyLocalMove(boardFixture(), "B", "s2", 0);
        expect(orderOf(moved, "s1")).toEqual(["A", "C", "D"]);
        expect(positionsOf(moved, "s1")).toEqual([0, 1, 2]);
        expect(orderOf(moved, "s2")).toEqual(["B", "X"]);
        expect(positionsOf(moved, "s2")).toEqual([0, 1]);
        expect(
            moved.sections.find((entry) => entry.id === "s2")?.blocks.find((entry) => entry.id === "B")
                ?.sectionId,
        ).toBe("s2");
    });

    it("keeps the block in its section when no target section is given", () => {
        const moved = applyLocalMove(boardFixture(), "D", null, 0);
        expect(orderOf(moved, "s1")).toEqual(["D", "A", "B", "C"]);
    });

    it("clamps a position past the end of the section", () => {
        const moved = applyLocalMove(boardFixture(), "A", "s1", 99);
        expect(orderOf(moved, "s1")).toEqual(["B", "C", "D", "A"]);
        expect(positionsOf(moved, "s1")).toEqual([0, 1, 2, 3]);
    });

    it("returns the board unchanged for an unknown block or section", () => {
        const board = boardFixture();
        expect(applyLocalMove(board, "missing", "s1", 0)).toBe(board);
        expect(applyLocalMove(board, "B", "missing", 0)).toBe(board);
    });
});
