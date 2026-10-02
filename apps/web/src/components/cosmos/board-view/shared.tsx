import type { BoardBlock } from "@cosmos/contracts";


const BLOCK_TYPE_LABELS: Record<string, string> = {
    feed: "阅读流",
    spotlight: "热点",
    // type 键是看板布局里已持久化的标识（改它要迁移），标签随产品术语改为「采集计划」。
    "source-health": "采集计划",
    "topic-list": "Topic 列表",
    collection: "收藏夹",
};

export const BLOCK_TYPE_OPTIONS = [
    "feed",
    "spotlight",
    "source-health",
    "topic-list",
    "collection",
] as const;

/** 只读的 config.limit 提取；非正整数一律回退默认值。 */
export function blockLimit(block: BoardBlock, fallback: number): number {
    const raw = block.config.limit;
    if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) {
        return raw;
    }
    return fallback;
}

export function configString(block: BoardBlock, key: string): string | null {
    const raw = block.config[key];
    return typeof raw === "string" && raw.trim() !== "" ? raw : null;
}

export function blockTypeLabel(type: string): string {
    return BLOCK_TYPE_LABELS[type] ?? type;
}

export function BlockPlaceholder({ text }: { text: string }) {
    return (
        <div className="flex flex-col items-center gap-1 rounded-[var(--radius-panel)] bg-[color-mix(in_srgb,var(--foreground)_4%,var(--background))] px-6 py-10 text-center">
            <p className="text-sm leading-6 text-muted-foreground">{text}</p>
        </div>
    );
}
