"use client";

import { useState, type ReactNode } from "react";

import {
    DndContext,
    DragOverlay,
    KeyboardSensor,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
    type DragEndEvent,
    type DragStartEvent,
    type UniqueIdentifier,
} from "@dnd-kit/core";
import {
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type { BoardBlock, BoardDetail } from "@cosmos/contracts";

import { GripVertical } from "lucide-react";

import { resolveDropTarget } from "./board-drag";

const BLOCK_TYPE_LABELS: Record<string, string> = {
    feed: "阅读流",
    spotlight: "热点",
    "source-health": "来源健康",
    "topic-list": "Topic 列表",
    collection: "收藏夹",
};

function blockTypeLabel(type: string): string {
    return BLOCK_TYPE_LABELS[type] ?? type;
}

/**
 * 拖动按钮用原生 `<button>`，不用 `@/components/ui/button`：后者的 Base UI 包装会
 * 接管指针事件，dnd-kit 的 PointerSensor 收不到 pointerdown（实测拖拽无法激活）。
 * 键盘传感器仍然工作在同一节点上（Space 抓取、方向键移动、Space 放下）。
 */
function SortableBlockItem({ block, children }: { block: BoardBlock; children: ReactNode }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: block.id,
    });
    return (
        <div
            ref={setNodeRef}
            data-block-id={block.id}
            data-block-type={block.type}
            style={{
                transform: CSS.Transform.toString(transform),
                transition,
                // 拖动中的原件让位给浮层，只留位置不塌陷。
                opacity: isDragging ? 0.35 : undefined,
            }}
        >
            {children}
            <button
                type="button"
                aria-label={`拖动排序 ${blockTypeLabel(block.type)}`}
                className="mt-1 inline-flex h-6 cursor-grab items-center gap-1 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none active:cursor-grabbing"
                {...attributes}
                {...listeners}
            >
                <GripVertical className="size-3" aria-hidden />
                拖动
            </button>
        </div>
    );
}

/**
 * 编辑模式下的区块拖拽排序（BRD-002「用户可调整顺序」）。排序只改展示配置：
 * 松手时把落点解析成 `moveBlock(blockId, sectionId, position)`，服务端重排后返回
 * 新树。上移/下移按钮与键盘拖拽（Space 抓取 + 方向键 + Space 放下）同时保留，
 * 拖拽不是唯一排序路径。
 */
export function BoardBlockList({
    board,
    sectionId,
    blocks,
    renderBlock,
    onMoveBlock,
}: {
    board: BoardDetail;
    sectionId: string;
    blocks: readonly BoardBlock[];
    renderBlock: (block: BoardBlock, index: number) => ReactNode;
    onMoveBlock: (blockId: string, targetSectionId: string, position: number) => Promise<void>;
}) {
    const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
    // PointerSensor 要求先移动 4px 才激活：避免编辑区块控件时误触拖拽。
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    const handleDragEnd = (event: DragEndEvent): void => {
        setActiveId(null);
        const { active, over } = event;
        // 只用 dnd-kit 的 `over`：拖动期间"其他区块让位"的预览就是按它算的，提交必须
        // 用同一个结果，否则预览与实际结果会分叉（实测过：预览 [A,C,B,D]、落库 [A,C,D,B]）。
        const target = over ? resolveDropTarget(board, String(active.id), String(over.id)) : null;
        if (!target) {
            return;
        }
        void onMoveBlock(target.blockId, target.sectionId, target.position);
    };

    const activeBlock = activeId
        ? blocks.find((block) => block.id === activeId) ?? null
        : null;

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={(event: DragStartEvent) => setActiveId(event.active.id)}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveId(null)}
        >
            <SortableContext
                id={sectionId}
                items={blocks.map((block) => block.id)}
                strategy={verticalListSortingStrategy}
            >
                {blocks.map((block, index) => (
                    <SortableBlockItem key={block.id} block={block}>
                        {renderBlock(block, index)}
                    </SortableBlockItem>
                ))}
            </SortableContext>
            {/* dropAnimation 关掉：松手后本地顺序立刻落定（见 use-board-workspace 的乐观
                更新），浮层再飞回原位会与已落定的布局打架，看起来就是闪一下。 */}
            <DragOverlay dropAnimation={null}>
                {activeBlock ? (
                    <div
                        data-dnd-overlay
                        className="rounded-sm border bg-card px-3 py-2 text-sm shadow-lg"
                    >
                        {blockTypeLabel(activeBlock.type)}
                    </div>
                ) : null}
            </DragOverlay>
        </DndContext>
    );
}
