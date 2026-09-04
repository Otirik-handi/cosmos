import { ExternalLink, Image as ImageIcon, X } from "lucide-react";
import { useEffect, useRef } from "react";

import type {
    AssetSnapshot,
    StoryDetail,
} from "@cosmos/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type StoryPanelProps = {
    onClose: () => void;
    story: StoryDetail;
};

const KIND_LABELS: Record<string, string> = {
    image: "图片",
    audio: "音频",
    video: "视频",
    enclosure: "附件",
};

const STATUS_LABELS: Record<AssetSnapshot["status"], string> = {
    saved: "已保存",
    metadata_only: "仅记录元数据",
    skipped: "未保存",
    failed: "保存失败",
};

function formatBytes(value: number | null): string | null {
    if (value === null) {
        return null;
    }
    if (value >= 1024 * 1024) {
        return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${Math.max(1, Math.round(value / 1024))} KB`;
}

function kindLabel(kind: string): string {
    return KIND_LABELS[kind] ?? kind;
}

/**
 * 附件区：已保存媒体用站内图片展示（断网可读），其余状态给出真实降级
 * 文案与原因，并保留原文外链，不伪造离线成功（ADR-0005）。
 */
function RevisionAssets({ assets }: { assets: readonly AssetSnapshot[] }) {
    if (assets.length === 0) {
        return null;
    }
    return (
        <section aria-label="媒体" className="grid gap-3 border-t pt-4">
            {assets.map((asset) => {
                const label = kindLabel(asset.kind);
                if (asset.status === "saved") {
                    return (
                        <figure
                            key={asset.id}
                            className="overflow-hidden rounded-sm border bg-muted/40"
                            data-asset-status="saved"
                            data-asset-id={asset.id}
                        >
                            <img
                                src={`/api/v1/assets/${asset.id}`}
                                alt={`已保存${label}`}
                                className="max-h-96 w-full object-contain"
                                loading="lazy"
                            />
                            <figcaption className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                                <ImageIcon aria-hidden={true} className="size-3.5" />
                                已保存本地，可离线查看
                                {formatBytes(asset.byteSize) && (
                                    <span>· {formatBytes(asset.byteSize)}</span>
                                )}
                            </figcaption>
                        </figure>
                    );
                }
                const reason = asset.errorMessage
                    ?? (asset.status === "metadata_only"
                        ? "按策略仅记录元数据"
                        : asset.status === "skipped"
                            ? "超过预算或被策略拦截"
                            : "下载失败");
                return (
                    <p
                        key={asset.id}
                        className="flex flex-wrap items-center gap-2 text-sm"
                        data-asset-status={asset.status}
                        data-asset-id={asset.id}
                    >
                        <span className="text-muted-foreground">{label}</span>
                        <Badge variant="secondary">{STATUS_LABELS[asset.status]}</Badge>
                        <span className="text-muted-foreground">{reason}</span>
                        {asset.sourceUrl && (
                            <a
                                href={asset.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 rounded-sm text-primary underline-offset-4 hover:underline focus-visible:border-ring focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none"
                            >
                                <ExternalLink aria-hidden={true} className="size-3.5" />
                                查看原文外链
                            </a>
                        )}
                    </p>
                );
            })}
        </section>
    );
}

/**
 * 阅读抽屉：固定定位的响应式阅读层，不依赖 Dialog 原语。
 * 打开时焦点进入关闭按钮，Escape 关闭，卸载时把焦点还给触发按钮。
 */
export function StoryPanel({ onClose, story }: StoryPanelProps) {
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const onCloseRef = useRef(onClose);

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        const previousFocus = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        closeButtonRef.current?.focus();
        const handleKeyDown = (event: KeyboardEvent): void => {
            if (event.key === "Escape") {
                event.stopPropagation();
                onCloseRef.current();
            }
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            previousFocus?.focus();
        };
    }, []);

    const currentRevision = story.entry.revisions[0];
    const currentWebUrl = currentRevision?.webUrl ?? null;

    return (
        <div
            className="fixed inset-0 z-50 bg-background/70"
            onClick={onClose}
        >
            <div
                aria-labelledby="cosmos-story-title"
                aria-modal="true"
                role="dialog"
                className="absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col rounded-t-[var(--radius-panel)] border bg-card shadow-[var(--elevation-dialog)] sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-full sm:max-w-xl sm:rounded-r-none sm:rounded-bl-[var(--radius-panel)]"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-4 border-b px-6 py-5">
                    <div className="flex min-w-0 flex-col gap-1">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Story 详情</p>
                        <h2
                            id="cosmos-story-title"
                            className="font-display text-2xl font-semibold leading-snug tracking-tight"
                        >
                            {story.story.title}
                        </h2>
                        <p className="text-sm text-muted-foreground">
                            {story.entry.sourceName} · {story.entry.revisions.length} 个 Revision
                        </p>
                    </div>
                    <Button
                        ref={closeButtonRef}
                        variant="ghost"
                        size="sm"
                        onClick={onClose}
                    >
                        <X data-icon="inline-start" />
                        关闭
                    </Button>
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
                    {currentWebUrl && (
                        <a
                            href={currentWebUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex w-fit items-center gap-1.5 rounded-sm text-sm text-primary underline-offset-4 hover:underline focus-visible:border-ring focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none"
                        >
                            <ExternalLink aria-hidden={true} className="size-3.5" />
                            打开原文
                        </a>
                    )}
                    <div className="max-w-prose whitespace-pre-wrap text-sm leading-7">
                        {currentRevision?.contentText ?? "暂无正文"}
                    </div>
                    <RevisionAssets assets={currentRevision?.assets ?? []} />
                    <dl className="grid gap-4 border-t pt-4 text-sm md:grid-cols-2">
                        <div className="min-w-0">
                            <dt className="font-medium">Entry</dt>
                            <dd className="truncate text-muted-foreground">{story.entry.id}</dd>
                        </div>
                        <div className="min-w-0">
                            <dt className="font-medium">Source</dt>
                            <dd className="truncate text-muted-foreground">
                                {story.entry.sourceName} · {story.entry.sourceKind}
                            </dd>
                        </div>
                    </dl>
                    <div className="flex flex-wrap gap-2 pb-2">
                        {story.entry.revisions.map((revision) => (
                            <Badge key={revision.id} variant="secondary">
                                Revision {revision.revision} · {revision.id}
                            </Badge>
                        ))}
                        {story.entry.observations.map((observation) => (
                            <Badge key={observation.id} variant="outline">
                                Observation · {observation.webUrl ?? "无网页 URL"}
                            </Badge>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
