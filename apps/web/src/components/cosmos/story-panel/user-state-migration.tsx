"use client";

import type { MigrateStoryUserStateCommand, StoryDetail } from "@cosmos/contracts";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

type NamedRef = { id: string; name: string };

/** The Story-target state currently sitting on one member of the split family. */
export type StoryUserStateSnapshot = {
    favorite: boolean;
    labels: readonly NamedRef[];
    collections: readonly NamedRef[];
    annotations: readonly NamedRef[];
    placements: readonly NamedRef[];
};

const emptySelection = {
    favorite: false,
    labelIds: [] as string[],
    collectionIds: [] as string[],
    annotationIds: [] as string[],
    spotlightPlacementIds: [] as string[],
};

/** Past this many rows the section warns that it is a bulk operation (ADR-0020 decision 6). */
const BULK_HINT_THRESHOLD = 20;

type Props = {
    busy: boolean;
    onLoadSource: (storyId: string) => Promise<StoryUserStateSnapshot>;
    onMigrate: (input: {
        sourceStoryId: string;
        command: MigrateStoryUserStateCommand;
    }) => Promise<void>;
    story: StoryDetail;
};

/**
 * Moves Story-target user state between the members of one split family.
 *
 * It lives on the historical shell because the shell is the only member that
 * knows the whole family: a successor has no back-reference to its shell in the
 * read model. Picking a successor as the source is what makes this the undo —
 * the same command in the opposite direction (ADR-0020 decision 3).
 */
export function StoryUserStateMigrationSection({ busy, onLoadSource, onMigrate, story }: Props) {
    const shell = story.story;
    const family = [
        { storyId: shell.id, title: `${shell.title}（本历史壳）` },
        ...shell.replacedBy.map((successor) => ({
            storyId: successor.storyId,
            title: successor.title,
        })),
    ];
    const [sourceStoryId, setSourceStoryId] = useState(shell.id);
    const [targetStoryId, setTargetStoryId] = useState(shell.replacedBy[0]?.storyId ?? "");
    // The snapshot belongs to the member it was read from, so a stale one is
    // simply not the current source's state — no reset needed when the source
    // changes, which also keeps the reset out of the effect body.
    const [loaded, setLoaded] = useState<
        { storyId: string; snapshot: StoryUserStateSnapshot } | null
    >(null);
    const [selection, setSelection] = useState(emptySelection);
    const [error, setError] = useState<string | null>(null);

    // The loader is called from an effect but must not drive it: a parent
    // re-render hands down a new function identity, and depending on it would
    // cancel every in-flight read before it can commit. Only the source Story
    // changing should start a read.
    const loadSourceRef = useRef(onLoadSource);
    useEffect(() => {
        loadSourceRef.current = onLoadSource;
    }, [onLoadSource]);

    useEffect(() => {
        let cancelled = false;
        void loadSourceRef.current(sourceStoryId)
            .then((snapshot) => {
                if (!cancelled) {
                    setLoaded({ storyId: sourceStoryId, snapshot });
                    setError(null);
                }
            })
            .catch((caught: unknown) => {
                if (!cancelled) {
                    setError(caught instanceof Error ? caught.message : "读取标记失败。");
                }
            });
        return () => {
            cancelled = true;
        };
    }, [sourceStoryId]);

    const source = loaded !== null && loaded.storyId === sourceStoryId ? loaded.snapshot : null;

    const targetOptions = family.filter((member) => member.storyId !== sourceStoryId);
    const summary = [
        selection.favorite ? "收藏 1" : null,
        selection.labelIds.length > 0 ? `标签 ${selection.labelIds.length}` : null,
        selection.collectionIds.length > 0 ? `收藏夹 ${selection.collectionIds.length}` : null,
        selection.annotationIds.length > 0 ? `批注 ${selection.annotationIds.length}` : null,
        selection.spotlightPlacementIds.length > 0
            ? `看板固定 ${selection.spotlightPlacementIds.length}`
            : null,
    ].filter((part): part is string => part !== null);
    const selectedCount = selection.labelIds.length + selection.collectionIds.length
        + selection.annotationIds.length + selection.spotlightPlacementIds.length
        + (selection.favorite ? 1 : 0);

    const submit = async (): Promise<void> => {
        if (!targetStoryId || targetStoryId === sourceStoryId) {
            setError("请选择另一个成员作为去向。");
            return;
        }
        setError(null);
        try {
            await onMigrate({
                sourceStoryId,
                command: { ...selection, targetStoryId },
            });
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "迁移失败。");
            return;
        }
        // The state now lives elsewhere, so re-read the source to drop the rows
        // that moved instead of leaving a stale checklist on screen.
        setLoaded({
            storyId: sourceStoryId,
            snapshot: await onLoadSource(sourceStoryId),
        });
        setSelection(emptySelection);
    };

    const toggle = (key: keyof Omit<typeof emptySelection, "favorite">, id: string): void => {
        setSelection((current) => {
            const ids = current[key];
            return {
                ...current,
                [key]: ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id],
            };
        });
    };

    return (
        <section
            aria-label="迁移用户状态"
            className="border-b pb-4"
            data-story-user-state-migration="true"
        >
            <h3 className="font-medium">迁移用户状态</h3>
            <p className="mt-2 text-sm text-muted-foreground">
                拆分时收藏、标签、收藏夹、批注与看板固定都留在本条历史壳上。在这里把它们搬到该去的后继；
                把后继上的标记迁回本壳，就是撤销这次迁移。
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="grid gap-1 text-sm">
                    从
                    <select
                        aria-label="迁移来源"
                        className="rounded-sm border bg-card px-2 py-1 text-sm"
                        disabled={busy}
                        value={sourceStoryId}
                        onChange={(event) => {
                            const next = event.target.value;
                            setSourceStoryId(next);
                            // A new source invalidates both the checklist and a
                            // target that is now the source itself.
                            setSelection(emptySelection);
                            setError(null);
                            if (next === targetStoryId) {
                                setTargetStoryId(
                                    family.find((member) => member.storyId !== next)?.storyId ?? "",
                                );
                            }
                        }}
                    >
                        {family.map((member) => (
                            <option key={member.storyId} value={member.storyId}>
                                {member.title}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="grid gap-1 text-sm">
                    迁到
                    <select
                        aria-label="迁移去向"
                        className="rounded-sm border bg-card px-2 py-1 text-sm"
                        disabled={busy || targetOptions.length === 0}
                        value={targetStoryId}
                        onChange={(event) => {
                            setTargetStoryId(event.target.value);
                        }}
                    >
                        {targetOptions.map((member) => (
                            <option key={member.storyId} value={member.storyId}>
                                {member.title}
                            </option>
                        ))}
                    </select>
                </label>
            </div>

            {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
            {source === null && !error && (
                <p className="mt-3 text-sm text-muted-foreground">正在读取该成员的标记…</p>
            )}
            {source !== null && (
                <div className="mt-3 grid gap-2">
                    {source.favorite && (
                        <label className="flex items-center gap-2 text-sm">
                            <input
                                type="checkbox"
                                aria-label="迁移收藏"
                                disabled={busy}
                                checked={selection.favorite}
                                onChange={(event) => {
                                    setSelection((current) => ({
                                        ...current,
                                        favorite: event.target.checked,
                                    }));
                                }}
                            />
                            收藏
                        </label>
                    )}
                    {source.labels.map((label) => (
                        <label key={label.id} className="flex items-center gap-2 text-sm">
                            <input
                                type="checkbox"
                                aria-label={`迁移标签 ${label.name}`}
                                disabled={busy}
                                checked={selection.labelIds.includes(label.id)}
                                onChange={() => {
                                    toggle("labelIds", label.id);
                                }}
                            />
                            标签：{label.name}
                        </label>
                    ))}
                    {source.collections.map((collection) => (
                        <label key={collection.id} className="flex items-center gap-2 text-sm">
                            <input
                                type="checkbox"
                                aria-label={`迁移收藏夹 ${collection.name}`}
                                disabled={busy}
                                checked={selection.collectionIds.includes(collection.id)}
                                onChange={() => {
                                    toggle("collectionIds", collection.id);
                                }}
                            />
                            收藏夹：{collection.name}
                        </label>
                    ))}
                    {source.annotations.map((annotation) => (
                        <label key={annotation.id} className="flex items-center gap-2 text-sm">
                            <input
                                type="checkbox"
                                aria-label={`迁移批注 ${annotation.name}`}
                                disabled={busy}
                                checked={selection.annotationIds.includes(annotation.id)}
                                onChange={() => {
                                    toggle("annotationIds", annotation.id);
                                }}
                            />
                            批注：{annotation.name}
                        </label>
                    ))}
                    {source.placements.map((placement) => (
                        <label key={placement.id} className="flex items-center gap-2 text-sm">
                            <input
                                type="checkbox"
                                aria-label="迁移看板固定"
                                disabled={busy}
                                checked={selection.spotlightPlacementIds.includes(placement.id)}
                                onChange={() => {
                                    toggle("spotlightPlacementIds", placement.id);
                                }}
                            />
                            看板固定
                        </label>
                    ))}
                    {selectedCount === 0 && (
                        <p className="text-sm text-muted-foreground">这个成员上没有可迁移的标记。</p>
                    )}
                </div>
            )}

            {selectedCount > 0 && (
                <p className="mt-3 text-sm text-muted-foreground" data-testid="migration-summary">
                    即将迁移：{summary.join("、")}
                    {selectedCount > BULK_HINT_THRESHOLD && "（这是一次批量操作，请确认去向无误）"}
                </p>
            )}
            <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3 w-fit"
                disabled={busy || selectedCount === 0 || targetOptions.length === 0}
                onClick={() => {
                    void submit();
                }}
                data-testid="story-user-state-migrate-submit"
            >
                迁移这些标记
            </Button>
        </section>
    );
}
