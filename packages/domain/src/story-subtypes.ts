export const storyKinds = ["event", "document", "media", "thread"] as const;

export type StoryKind = (typeof storyKinds)[number];

export const storySubtypeStatuses = ["active", "deprecated", "retired"] as const;

export type StorySubtypeStatus = (typeof storySubtypeStatuses)[number];

/**
 * A managed Story subtype (ORG-013). Built-in and future plugin subtypes share
 * this shape; the id is namespaced by its core kind so a subtype can never
 * silently change meaning by moving between kinds.
 */
export interface StorySubtypeRegistration {
    id: string;
    kind: StoryKind;
    version: number;
    label: string;
    description: string | null;
    status: StorySubtypeStatus;
    /**
     * Identity policy the subtype declares for future automatic clustering
     * (ORG-021). v1 only records the identifier; nothing executes it yet.
     */
    identityPolicy: string | null;
    owner: string;
}

export const storySubtypeRegistry: readonly StorySubtypeRegistration[] = [
    {
        id: "media.comic",
        kind: "media",
        version: 1,
        label: "漫画",
        description: "同一部漫画作品的平台页面、转发与镜像。",
        status: "active",
        identityPolicy: "same-work-v1",
        owner: "core",
    },
    {
        id: "media.anime",
        kind: "media",
        version: 1,
        label: "动画",
        description: "同一部动画作品的平台页面、转发与镜像。",
        status: "active",
        identityPolicy: "same-work-v1",
        owner: "core",
    },
    {
        id: "media.video",
        kind: "media",
        version: 1,
        label: "视频",
        description: "同一段视频或影像作品的平台页面、转发与镜像。",
        status: "active",
        identityPolicy: "same-work-v1",
        owner: "core",
    },
];

/**
 * Product consumers only see active and deprecated registrations; retired ones
 * stay in the registry for old data but are not offered for new assignments.
 */
export function listStorySubtypes(input?: {
    kind?: StoryKind;
    statuses?: readonly StorySubtypeStatus[];
}): StorySubtypeRegistration[] {
    const statuses = input?.statuses ?? ["active", "deprecated"];
    return storySubtypeRegistry.filter((entry) => (
        (input?.kind === undefined || entry.kind === input.kind)
        && statuses.includes(entry.status)
    ));
}

export type StorySubtypeRejection = "empty" | "unregistered" | "kind_mismatch" | "not_active";

export type StorySubtypeCheck =
    | { readonly ok: true; readonly registration: StorySubtypeRegistration | null }
    | { readonly ok: false; readonly reason: StorySubtypeRejection; readonly registration: StorySubtypeRegistration | null };

/**
 * Write-side gate for `updateStoryRevision` and `splitStory`: a subtype must be
 * registered, belong to the Story's core kind, and still be active. Unknown
 * values already stored stay readable; they simply cannot be written again.
 * The registry argument lets a future plugin registry extend the built-in list.
 */
export function checkStorySubtype(
    kind: StoryKind,
    subtype: string | null,
    registry: readonly StorySubtypeRegistration[] = storySubtypeRegistry,
): StorySubtypeCheck {
    if (subtype === null) {
        return { ok: true, registration: null };
    }
    if (subtype.trim() === "") {
        return { ok: false, reason: "empty", registration: null };
    }
    const registration = registry.find((entry) => entry.id === subtype) ?? null;
    if (!registration) {
        return { ok: false, reason: "unregistered", registration: null };
    }
    if (registration.kind !== kind) {
        return { ok: false, reason: "kind_mismatch", registration };
    }
    if (registration.status !== "active") {
        return { ok: false, reason: "not_active", registration };
    }
    return { ok: true, registration };
}
