import type { EntryListItem, EntryStoryRelationType, StoryDetail } from "@cosmos/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { relationTypeLabel } from "./labels";

type Props = {
    busy: boolean;
    entryOptions?: readonly Pick<EntryListItem, "id" | "title" | "sourceName">[];
    linkEntryId: string;
    linkRelationType: EntryStoryRelationType;
    onLinkEntry?: (input: { entryId: string; relationType: EntryStoryRelationType }) => Promise<void>;
    onUnlinkEntry?: (entryId: string) => Promise<void>;
    setLinkEntryId: (value: string) => void;
    setLinkRelationType: (value: EntryStoryRelationType) => void;
    story: StoryDetail;
    submitLinkEntry: () => Promise<void>;
    submitUnlinkEntry: (entryId: string) => Promise<void>;
    title: string;
};

export function EvidenceSection({ busy, entryOptions = [], linkEntryId, linkRelationType, onLinkEntry, onUnlinkEntry, setLinkEntryId, setLinkRelationType, story, submitLinkEntry, submitUnlinkEntry, title }: Props) {
    return (
            <section aria-label="证据来源" className="border-b pb-4">
                <h3 className="font-medium">证据来源（{story.evidence.length}）</h3>
                {story.evidence.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                        还没有其它 Story 引用本 Story 的条目；可在下方添加一条证据或提及。
                    </p>
                ) : (
                    <ul className="mt-2 grid gap-2" data-story-evidence="true">
                        {story.evidence.map((item) => (
                            <li
                                key={item.entryId}
                                data-story-evidence-entry-id={item.entryId}
                                className="flex flex-col gap-1 rounded-sm border bg-muted/40 px-3 py-2"
                            >
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                                    <Badge variant="secondary">
                                        {relationTypeLabel(item.relationType)}
                                    </Badge>
                                    <span>{item.sourceName}</span>
                                    {item.reason && <span>· {item.reason}</span>}
                                </div>
                                <span className="truncate text-sm">
                                    {item.title ?? item.entryId}
                                </span>
                                <span className="truncate text-xs text-muted-foreground">
                                    {item.entryId}
                                </span>
                                {onUnlinkEntry && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="w-fit"
                                        disabled={busy}
                                        onClick={() => void submitUnlinkEntry(item.entryId)}
                                    >
                                        解除
                                    </Button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
                {onLinkEntry && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <select
                            aria-label="选择证据条目"
                            value={linkEntryId}
                            disabled={busy}
                            className="max-w-xs rounded-sm border bg-card px-2 py-1 text-sm"
                            onChange={(event) => setLinkEntryId(event.target.value)}
                        >
                            <option value="">选择条目…</option>
                            {entryOptions.map((option) => (
                                <option key={option.id} value={option.id}>
                                    {option.sourceName} · {option.title}
                                </option>
                            ))}
                        </select>
                        <select
                            aria-label="证据关系类型"
                            value={linkRelationType}
                            disabled={busy}
                            className="rounded-sm border bg-card px-2 py-1 text-sm"
                            onChange={(event) => {
                                setLinkRelationType(event.target.value as EntryStoryRelationType);
                            }}
                        >
                            <option value="evidence_for">证据</option>
                            <option value="mentions">提及</option>
                        </select>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={busy || !linkEntryId}
                            onClick={() => void submitLinkEntry()}
                        >
                            添加
                        </Button>
                    </div>
                )}
            </section>
    );
}
