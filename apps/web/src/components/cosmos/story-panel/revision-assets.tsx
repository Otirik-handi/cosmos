import {
    ExternalLink,
    Image as ImageIcon,
} from "lucide-react";
import {
    AssetSnapshot,
} from "@cosmos/contracts";
import {
    Badge,
} from "@/components/ui/badge";
import {
    STATUS_LABELS,
    formatBytes,
    kindLabel,
} from "./labels";

/**
 * 附件区：已保存媒体用站内图片展示（断网可读），其余状态给出真实降级
 * 文案与原因，并保留原文外链，不伪造离线成功（ADR-0005）。
 */
export function RevisionAssets({ assets }: { assets: readonly AssetSnapshot[] }) {
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
                        {asset.status !== "metadata_only"
                            && (asset.attemptCount ?? 0) > 0 && (
                            <span className="text-xs text-muted-foreground">
                                已尝试 {asset.attemptCount} 次
                            </span>
                        )}
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
