import { ExternalLink, X } from "lucide-react";
import { useEffect, useRef } from "react";

import type { StoryDetail } from "@cosmos/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type StoryPanelProps = {
    onClose: () => void;
    story: StoryDetail;
};

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
