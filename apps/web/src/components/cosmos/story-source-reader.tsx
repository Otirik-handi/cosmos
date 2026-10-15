import { useEffect, useState } from "react";
import type { EntryDetail, StoryDetail, StructuredContentViewContract } from "@cosmos/contracts";

import { client } from "@/app/home/page-runtime";
import { Button } from "@/components/ui/button";
import { messages } from "@/copy/messages";
import { ContentBlockReader } from "./content-block-reader";
import { safeContentUrl } from "@/lib/content-url";
import { RevisionAssets } from "./story-panel/revision-assets";

const copy = messages.reading.content;

export function selectReadingSources(story: StoryDetail): EntryDetail[] {
    const entries = new Map(story.entries.map((entry) => [entry.id, entry]));
    if (story.entry) entries.set(story.entry.id, story.entry);
    return [...entries.values()].filter((entry) => entry.revisions.length > 0)
        .sort((a, b) => a.id.localeCompare(b.id));
}

type ContentLoader = (revisionId: string) => Promise<StructuredContentViewContract>;
const loadRevisionContent: ContentLoader = (revisionId) => client.revisionContent(revisionId);

function SourceBody({ entry, loadContent }: { entry: EntryDetail; loadContent: ContentLoader }) {
    const revision = entry.revisions[0]!;
    const [result, setResult] = useState<StructuredContentViewContract | null>(null);
    const [error, setError] = useState(false);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        let active = true;
        void loadContent(revision.id).then((view) => {
            if (active) setResult(view);
        }).catch(() => { if (active) setError(true); });
        return () => { active = false; };
    }, [revision.id, attempt, loadContent]);
    if (error) return <div role="alert" className="mt-4 text-sm">
        <p>{copy.failed}</p>
        <Button variant="outline" size="sm" onClick={() => { setError(false); setAttempt((value) => value + 1); }}>{copy.retry}</Button>
    </div>;
    if (!result) return <p role="status" className="mt-4 text-sm text-muted-foreground">{copy.loading}</p>;
    const representation = result.representation;
    const originalUrl = safeContentUrl(revision.webUrl);
    return <div className="mt-4" data-reading-mode={result.readingMode}>
        {representation?.status === "partial" && <p role="status" className="text-sm text-muted-foreground">{copy.partial}</p>}
        {result.readingMode === "legacy-text" && <p className="text-sm text-muted-foreground">{copy.legacy}</p>}
        {representation && representation.status !== "failed"
            ? <ContentBlockReader blocks={representation.blocks} assets={revision.assets} />
            : result.readingMode === "legacy-text"
                ? <><p className="my-4 whitespace-pre-wrap text-[16px] leading-[1.8] [overflow-wrap:anywhere]">{result.contentText || copy.empty}</p><RevisionAssets assets={revision.assets} /></>
                : <p role="status" className="my-4 text-sm text-muted-foreground">{copy.unavailable}</p>}
        {representation?.blocks.length === 0 && <p className="my-4 text-sm text-muted-foreground">{copy.empty}</p>}
        {originalUrl && <a href={originalUrl} target="_blank" rel="noreferrer" className="inline-block mt-4 text-sm text-primary underline underline-offset-4">{copy.original}</a>}
    </div>;
}

export function StorySourceReader({ story, loadContent = loadRevisionContent }: {
    story: StoryDetail;
    loadContent?: ContentLoader;
}) {
    const sources = selectReadingSources(story);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const selected = sources.find((entry) => entry.id === selectedId) ?? sources[0];
    if (!selected) return <p className="mt-6 text-sm text-muted-foreground">{copy.noSources}</p>;
    return <section aria-label={copy.section} className="mt-7 border-t border-border pt-5">
        <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold">{copy.section}</h2>
            {sources.length > 1 && <label className="flex min-w-0 items-center gap-2 text-sm">
                <span className="shrink-0">{copy.select}</span>
                <select className="min-w-0 max-w-full rounded border border-border bg-background p-2" value={selected.id} onChange={(event) => setSelectedId(event.target.value)}>
                    {sources.map((entry) => <option key={entry.id} value={entry.id}>{entry.sourceName} · {entry.revisions[0]?.title}</option>)}
                </select>
            </label>}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{selected.sourceName} · {selected.revisions[0]?.title}{selectedId === null && sources.length > 1 ? copy.defaultSource : ""}</p>
        <SourceBody key={selected.revisions[0]!.id} entry={selected} loadContent={loadContent} />
    </section>;
}
