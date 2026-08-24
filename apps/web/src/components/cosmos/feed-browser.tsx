import { ExternalLink, Search, X } from "lucide-react";
import type { FormEventHandler } from "react";
import type { UseFormReturn } from "react-hook-form";
import { z } from "zod";

import type { FeedItem, SearchQuery, SourceSnapshot } from "@cosmos/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const searchSchema = z.object({
    text: z.string().trim().max(500).default(""),
    sourceId: z.string().default(""),
    publishedAfter: z.string().default(""),
    publishedBefore: z.string().default(""),
});

export type SearchFormValues = z.input<typeof searchSchema>;

/** 摘要摘录的最大字符数；约等于三行中文阅读宽度，超出部分以省略号收尾。 */
const EXCERPT_MAX_LENGTH = 240;
const EXCERPT_EMPTY_FALLBACK = "暂无摘要";
const HTML_ENTITY_PATTERN = /&(?:amp|lt|gt|quot|apos|#([0-9]+)|#x([0-9a-fA-F]+));/g;

function decodeHtmlEntities(value: string): string {
    const fromCodePoint = (codePoint: number, fallback: string): string => {
        // 超出 Unicode 范围的数值会让 String.fromCodePoint 抛错，此时保留实体原文。
        return codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : fallback;
    };
    return value.replace(HTML_ENTITY_PATTERN, (match, decimal?: string, hex?: string) => {
        if (decimal) {
            return fromCodePoint(Number.parseInt(decimal, 10), match);
        }
        if (hex) {
            return fromCodePoint(Number.parseInt(hex, 16), match);
        }
        switch (match) {
            case "&amp;": {
                return "&";
            }
            case "&lt;": {
                return "<";
            }
            case "&gt;": {
                return ">";
            }
            case "&quot;": {
                return "\"";
            }
            case "&apos;": {
                return "'";
            }
            default: {
                return match;
            }
        }
    });
}

/**
 * RSS 摘要是不可信外部文本：只输出纯文本摘录，绝不作为 HTML 渲染。
 * 标签剥离与实体解码必须保持确定性（SSR 与客户端结果一致），因此不使用 DOMParser。
 */
export function toReadableExcerpt(value: string | null | undefined): string {
    if (!value) {
        return EXCERPT_EMPTY_FALLBACK;
    }
    const plain = decodeHtmlEntities(value.replace(/<[^>]*>/g, " "))
        .replace(/\s+/g, " ")
        .trim();
    if (plain.length === 0) {
        return EXCERPT_EMPTY_FALLBACK;
    }
    if (plain.length > EXCERPT_MAX_LENGTH) {
        return `${plain.slice(0, EXCERPT_MAX_LENGTH)}…`;
    }
    return plain;
}

/** 稳定的中文短日期；解析失败或空值返回 null，由调用方决定是否隐藏。 */
function formatFeedDate(value: string | null | undefined): string | null {
    if (!value) {
        return null;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return null;
    }
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

type FeedBrowserProps = {
    activeSearch?: SearchQuery | null;
    feed: readonly FeedItem[];
    loading: boolean;
    loadingMore?: boolean;
    nextCursor: string | null;
    onClearSearch?: () => void;
    onLoadMore: () => Promise<void>;
    onOpenStory: (storyId: string) => Promise<void>;
    onSubmit: FormEventHandler<HTMLFormElement>;
    openingStoryId?: string | null;
    refreshing?: boolean;
    searchForm: UseFormReturn<SearchFormValues>;
    sources: readonly SourceSnapshot[];
};

function activeFilterLabels(
    activeSearch: SearchQuery | null,
    sources: readonly SourceSnapshot[],
): string[] {
    if (!activeSearch) {
        return [];
    }
    const labels: string[] = [];
    if (activeSearch.text) {
        labels.push(`“${activeSearch.text}”`);
    }
    if (activeSearch.sourceId) {
        const source = sources.find((candidate) => candidate.id === activeSearch.sourceId);
        labels.push(source ? `来源：${source.name}` : `来源：${activeSearch.sourceId}`);
    }
    const afterLabel = formatFeedDate(activeSearch.publishedAfter);
    if (afterLabel) {
        labels.push(`自 ${afterLabel}`);
    }
    const beforeLabel = formatFeedDate(activeSearch.publishedBefore);
    if (beforeLabel) {
        labels.push(`至 ${beforeLabel}`);
    }
    return labels;
}

export function FeedBrowser({
    activeSearch = null,
    feed,
    loading,
    loadingMore = false,
    nextCursor,
    onClearSearch,
    onLoadMore,
    onOpenStory,
    onSubmit,
    openingStoryId = null,
    refreshing = false,
    searchForm,
    sources,
}: FeedBrowserProps) {
    const filterChips = activeFilterLabels(activeSearch, sources);

    return (
        <section aria-label="阅读流" className="flex flex-col gap-5">
            <div className="flex flex-col gap-4 border-b pb-5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                    <h2 className="font-display text-2xl font-semibold tracking-tight">
                        Story Feed
                    </h2>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        {refreshing && <span>正在更新</span>}
                        {feed.length > 0 && <span>{feed.length} 篇内容</span>}
                    </div>
                </div>
                <form
                    className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center"
                    onSubmit={onSubmit}
                >
                    <Input
                        aria-label="搜索已保存内容"
                        placeholder="搜索标题或正文"
                        className="lg:max-w-xs"
                        {...searchForm.register("text")}
                    />
                    <select
                        aria-label="搜索来源"
                        className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                        {...searchForm.register("sourceId")}
                    >
                        <option value="">全部来源</option>
                        {sources.map((source) => (
                            <option key={source.id} value={source.id}>
                                {source.name}
                            </option>
                        ))}
                    </select>
                    <Input
                        aria-label="开始日期"
                        type="date"
                        {...searchForm.register("publishedAfter")}
                    />
                    <Input
                        aria-label="结束日期"
                        type="date"
                        {...searchForm.register("publishedBefore")}
                    />
                    <Button type="submit" variant="outline">
                        <Search data-icon="inline-start" />
                        搜索
                    </Button>
                </form>
                {filterChips.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted-foreground">当前筛选</span>
                        {filterChips.map((label) => (
                            <Badge key={label} variant="outline">
                                {label}
                            </Badge>
                        ))}
                        {onClearSearch && (
                            <Button size="xs" variant="ghost" onClick={onClearSearch}>
                                <X data-icon="inline-start" />
                                清除筛选
                            </Button>
                        )}
                    </div>
                )}
            </div>
            {loading && feed.length === 0 ? (
                <div role="status" className="flex flex-col gap-8 py-2">
                    <span className="sr-only">正在读取本地 Feed…</span>
                    {[0, 1, 2].map((index) => (
                        <div key={index} aria-hidden={true} className="flex flex-col gap-2.5">
                            <div className="h-3 w-44 rounded-full bg-muted" />
                            <div className="h-5 w-3/4 rounded-md bg-muted" />
                            <div className="h-3 w-full max-w-2xl rounded-full bg-muted" />
                            <div className="h-3 w-2/5 rounded-full bg-muted" />
                        </div>
                    ))}
                </div>
            ) : feed.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-[var(--radius-panel)] border border-dashed px-6 py-16 text-center">
                    <p className="font-display text-lg font-semibold">今天还没有可读的内容</p>
                    <p className="max-w-sm text-sm leading-6 text-muted-foreground">
                        暂无已保存内容，请先创建来源并触发录入。
                    </p>
                </div>
            ) : (
                <div className="flex flex-col">
                    {feed.map((item) => {
                        const dateLabel = formatFeedDate(item.publishedAt);
                        const opening = openingStoryId === item.storyId;
                        const openStory = (): void => {
                            // aria-disabled 保留焦点但不拦截键盘触发，这里守住重复请求。
                            if (opening) {
                                return;
                            }
                            void onOpenStory(item.storyId);
                        };
                        return (
                            <article
                                key={item.storyId}
                                className="flex flex-col gap-2 border-b py-5 first:pt-1 last:border-b-0 last:pb-1"
                            >
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                    <Badge variant="secondary">{item.storyKind}</Badge>
                                    <span className="font-medium text-foreground/80">
                                        {item.sourceName}
                                    </span>
                                    {dateLabel && <span>{dateLabel}</span>}
                                    {item.assets.length > 0 && (
                                        <span>含 {item.assets.length} 个附件</span>
                                    )}
                                </div>
                                <h3 className="font-display text-lg font-semibold leading-snug tracking-tight">
                                    <button
                                        type="button"
                                        aria-disabled={opening}
                                        onClick={openStory}
                                        className="rounded-sm text-left transition-colors [transition-duration:var(--motion-fast,90ms)] hover:text-primary focus-visible:border-ring focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none aria-disabled:pointer-events-none aria-disabled:opacity-50"
                                    >
                                        {item.title}
                                    </button>
                                </h3>
                                <p className="line-clamp-3 max-w-3xl text-sm leading-6 text-muted-foreground">
                                    {toReadableExcerpt(item.summary)}
                                </p>
                                <div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        aria-disabled={opening}
                                        onClick={openStory}
                                        className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
                                    >
                                        <ExternalLink data-icon="inline-start" />
                                        打开 Story
                                    </Button>
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}
            {nextCursor && !loading && (
                <div className="flex justify-center pt-2">
                    <Button
                        variant="outline"
                        disabled={loadingMore}
                        onClick={() => void onLoadMore()}
                    >
                        {loadingMore ? "正在加载…" : "加载更多"}
                    </Button>
                </div>
            )}
        </section>
    );
}
