import type {
    EntryDetail,
    PublicAssetSnapshot,
    RevisionDetail,
    StoryDetail,
} from "@cosmos/contracts";

/**
 * Product API 公开投影：Asset 只发公开字段。
 *
 * 公开读 DTO 已用 contracts 的 `publicAssetSnapshotSchema` 描述（它从 `assetSnapshotSchema`
 * 省略内部 Blob key），但仓储的读投影在运行期仍会带上 `storageKey`
 * （见 [`docs/spec/storage/0001-prisma-repository.md`](../../../../docs/spec/storage/0001-prisma-repository.md)：
 * 「仓储内部的 Asset snapshot 可能携带 storageKey，Product API 的公开投影另行剥离」）。
 * 所以出口必须逐个挑字段：类型只保证调用方期望的形状，真正的剥离在这里，
 * 且 `AssetSnapshot` 以后新增内部字段时默认不外发，不依赖后来的人回来补删除。
 */
export function toPublicAsset(asset: PublicAssetSnapshot) {
    return {
        id: asset.id,
        kind: asset.kind,
        status: asset.status,
        sourceUrl: asset.sourceUrl,
        mimeType: asset.mimeType,
        byteSize: asset.byteSize,
        errorMessage: asset.errorMessage ?? null,
        errorCode: asset.errorCode ?? null,
        attemptCount: asset.attemptCount ?? 0,
    };
}

function toPublicAssets<T extends { assets: readonly PublicAssetSnapshot[] }>(value: T) {
    return {
        ...value,
        assets: value.assets.map(toPublicAsset),
    };
}

/** feed、search、entries 的分页 DTO 结构相同：逐项挑字段即可。 */
export function toPublicPage<T extends { items: readonly { assets: readonly PublicAssetSnapshot[] }[] }>(page: T) {
    return {
        ...page,
        items: page.items.map(toPublicAssets),
    };
}

export function toPublicEntryDetail(entry: EntryDetail) {
    return {
        ...entry,
        revisions: entry.revisions.map(toPublicAssets),
    };
}

export function toPublicRevisionDetail(revision: RevisionDetail) {
    return toPublicAssets(revision);
}

/**
 * Story detail 有两处成员投影：单个主成员 `entry` 与成员列表 `entries`。
 * 历史壳可以没有主成员（ADR-0012 决定 2），因此 `entry` 必须允许为 null。
 */
export function toPublicStoryDetail(story: StoryDetail) {
    return {
        ...story,
        entry: story.entry === null ? null : toPublicEntryDetail(story.entry),
        entries: story.entries.map(toPublicEntryDetail),
    };
}
