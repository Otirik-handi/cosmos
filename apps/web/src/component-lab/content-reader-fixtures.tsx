import { useMemo } from "react";
import type { ContentBlockContract, StructuredContentViewContract } from "@cosmos/contracts";

import { ContentBlockReader } from "@/components/cosmos/content-block-reader";
import { StorySourceReader } from "@/components/cosmos/story-source-reader";
import { storyLabFixture } from "./product-fixtures";
import type { LabProps } from "./types";

const blocks: ContentBlockContract[] = [
    { id: "before", type: "paragraph", data: { inlines: [{ type: "text", text: "正文保留来源顺序。下面的图片尚未保存。" }] } },
    { id: "image", type: "image", data: { assetId: "lab-image", alt: "示例图片" } },
    { id: "after", type: "paragraph", data: { inlines: [{ type: "strong", inlines: [{ type: "text", text: "图片之后的正文" }] }] } },
    { id: "audio", type: "audio", data: { assetId: "lab-audio", title: "音频示例" } },
];
const assets = [
    { id: "lab-image", kind: "image" as const, status: "metadata_only" as const, sourceUrl: "https://example.test/image.png", mimeType: null, byteSize: null },
    { id: "lab-audio", kind: "audio" as const, status: "metadata_only" as const, sourceUrl: "https://example.test/audio.mp3", mimeType: null, byteSize: null },
];

export function renderContentBlockReaderLab() {
    return <ContentBlockReader blocks={blocks} assets={assets} />;
}

function SourceReaderFixture({ state }: { state: string }) {
    const story = useMemo(() => {
        const fixture = storyLabFixture(state === "empty" ? "empty" : "splittable", "合成文章", "历史正文");
        for (const entry of fixture.entries) {
            for (const revision of entry.revisions) {
                revision.assets = assets;
                revision.webUrl = `https://example.test/articles/${encodeURIComponent(entry.id)}`;
            }
        }
        return fixture;
    }, [state]);
    const loadContent = useMemo(() => async (revisionId: string): Promise<StructuredContentViewContract> => {
        if (state === "loading") return new Promise(() => {});
        if (state === "error") throw new Error("Synthetic read failure");
        const entry = story.entries.find((item) => item.revisions.some((revision) => revision.id === revisionId))!;
        const legacy = state === "legacy";
        const unavailable = state === "unavailable";
        return {
            entryId: entry.id,
            entryRevisionId: revisionId,
            readingMode: legacy ? "legacy-text" : unavailable ? "unavailable" : "representation",
            evidenceStatus: "available",
            contentText: `${entry.sourceName} 的历史正文`,
            representation: legacy || unavailable ? null : {
                id: `representation-${revisionId}`, entryRevisionId: revisionId,
                representationVersion: 1, parserVersion: "lab@1", status: state === "partial" ? "partial" : "complete",
                blocks, contentText: "合成正文", createdAt: "2026-01-01T00:00:00.000Z",
            },
        };
    }, [state, story]);
    return <StorySourceReader story={story} loadContent={loadContent} />;
}

export function renderStorySourceReaderLab(props: LabProps) {
    return <SourceReaderFixture key={String(props.state)} state={String(props.state ?? "complete")} />;
}
