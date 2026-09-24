import type { ContentKind, MinimalStoryProjection } from "./content.js";
import type { StoryKind } from "./story-subtypes.js";

export function mapContentKindToStoryKind(kind: ContentKind): StoryKind {
    switch (kind) {
        case "video":
        case "audio":
        case "image":
            return "media";
        case "comment":
            return "thread";
        case "post":
        case "article":
        case "listing":
            return "document";
    }
}

export function projectEntryToStory(input: {
    entryId: string;
    revisionId: string;
    title: string;
    summary?: string | null;
    kind?: StoryKind;
    subtype?: string | null;
    contentKind?: ContentKind;
}): MinimalStoryProjection {
    return {
        id: `story:${input.entryId}`,
        kind: input.kind
            ?? (input.contentKind
                ? mapContentKindToStoryKind(input.contentKind)
                : "document"),
        subtype: input.subtype ?? null,
        title: input.title,
        summary: input.summary ?? null,
        entryId: input.entryId,
        revisionId: input.revisionId,
    };
}
