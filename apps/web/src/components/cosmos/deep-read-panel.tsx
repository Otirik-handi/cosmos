"use client";

import { useEffect, useState } from "react";
import type { ArtifactSnapshot, EvidenceRefContract, StoryDeepReadRevisionDetail } from "@cosmos/contracts";
import { client } from "@/app/home/page-runtime";
import { ContentBlockReader } from "./content-block-reader";
import { DeepReadEvidence } from "./story-panel/deep-read-evidence";
import { useDeepRead, type DeepReadClient } from "./story-panel/use-deep-read";
import { StoryAgentFailure } from "./story-panel/story-agent-failure";
import { StoryGenerationActualCost } from "./story-panel/story-generation-cost";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { messages } from "@/copy/messages";

const copy = messages.reading.deepRead;

export function DeepReadReport({ revision, old = false, onEvidence }: {
    revision: StoryDeepReadRevisionDetail; old?: boolean; onEvidence: (evidence: EvidenceRefContract) => void;
}) {
    return <article className="min-w-0 space-y-6 [overflow-wrap:anywhere]" data-deep-read-revision={revision.revision}>
        <header className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs"><Badge variant="outline">{old ? copy.old : copy.current}</Badge><span>{copy.sourceStatuses[revision.sourceStatus]}</span></div>
            <h3 className="font-display text-xl font-semibold">{revision.headline}</h3>
            <dl className="space-y-1 text-xs text-muted-foreground">
                <div><dt className="inline">{copy.generatedAt}：</dt><dd className="inline"><time dateTime={revision.createdAt}>{revision.createdAt}</time></dd></div>
                <div><dt className="inline">{copy.actualModel}：</dt><dd className="inline">{revision.provider} / {revision.model}</dd></div>
            </dl>
            <StoryGenerationActualCost cost={revision.cost} />
        </header>
        {revision.sections.map((section) => <section key={section.id} className="min-w-0 border-t border-border pt-5">
            <div className="flex flex-wrap items-baseline gap-2"><h4 className="font-semibold">{section.heading}</h4><Badge variant="secondary">{section.kind === "opinion" ? copy.opinion : copy.fact}</Badge></div>
            <ContentBlockReader blocks={section.blocks} assets={[]} />
            <div className="flex flex-wrap gap-2">{section.evidence.map((evidence, index) => <DialogTrigger
                key={`${evidence.entryRevisionId}:${evidence.representationVersion}:${evidence.blockId ?? ""}:${index}`}
                render={<Button size="sm" variant="outline" />}
                onClick={() => onEvidence(evidence)}
            >{copy.evidenceLabel(index + 1)}</DialogTrigger>)}</div>
        </section>)}
    </article>;
}

function DeepReadVersions({ artifact, api, storyId }: { artifact: ArtifactSnapshot; api: DeepReadClient; storyId: string }) {
    const [selected, setSelected] = useState<number | null>(null);
    const [detail, setDetail] = useState<StoryDeepReadRevisionDetail | null>(null);
    const [error, setError] = useState(false);
    const [evidence, setEvidence] = useState<EvidenceRefContract | null>(null);
    const [attempt, setAttempt] = useState(0);
    const currentRevision = artifact.current?.revision ?? null;
    const isCurrent = selected === null || selected === currentRevision;
    useEffect(() => {
        if (selected === null || selected === currentRevision) return;
        let active = true;
        void api.storyDeepReadRevision(storyId, selected).then((result) => {
            if (active) { setDetail(result); setError(false); }
        }).catch(() => { if (active) setError(true); });
        return () => { active = false; };
    }, [api, currentRevision, attempt, selected, storyId]);
    const revision = isCurrent ? artifact.current : detail?.revision === selected ? detail : null;
    return <Dialog onOpenChange={(open) => { if (!open) setEvidence(null); }}>
        <div className="space-y-5 min-w-0">
            <label className="flex flex-wrap items-center gap-2 text-sm">{copy.version}
                <select aria-label={copy.version} className="min-w-0 max-w-full rounded border border-border bg-background p-2" value={selected ?? artifact.current?.revision ?? ""} onChange={(event) => { setSelected(Number(event.target.value)); setError(false); }}>
                    {artifact.revisions.slice(0, 50).map((item) => <option key={item.revision} value={item.revision}>{copy.versionLabel(item.revision)} · {copy.sourceStatuses[item.sourceStatus]}</option>)}
                </select>
            </label>
            {error ? <div role="alert"><p>{copy.notFound}</p><Button size="sm" variant="outline" onClick={() => setAttempt((value) => value + 1)}>{copy.reload}</Button></div>
                : !revision ? <p role="status">{copy.loading}</p>
                    : <DeepReadReport revision={revision} old={!isCurrent} onEvidence={setEvidence} />}
        </div>
        {evidence && <DeepReadEvidence key={`${evidence.entryRevisionId}:${evidence.representationVersion}:${evidence.blockId ?? ""}`} evidence={evidence} api={api} />}
    </Dialog>;
}

export function DeepReadPanel({ storyId, api = client }: { storyId: string; api?: DeepReadClient }) {
    return <DeepReadForStory key={storyId} storyId={storyId} api={api} />;
}

function DeepReadForStory({ storyId, api }: { storyId: string; api: DeepReadClient }) {
    const state = useDeepRead(storyId, api);
    const generation = state.generation;
    return <section aria-label={copy.title} className="min-w-0 rounded-[var(--radius-card)] border border-border bg-paper p-5 space-y-5 [overflow-wrap:anywhere]">
        <header className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-lg font-semibold">{copy.title}</h2>
            <Button size="sm" disabled={!state.ready || state.active || state.storageError || state.unknownRequest} onClick={() => void state.start()}>
                {generation?.status === "failed" ? copy.retry : state.artifact?.current ? copy.regenerate : copy.generate}
            </Button>
        </header>
        {!state.artifact?.current && <p className="text-sm text-muted-foreground">{copy.intro}</p>}
        <div aria-live="polite" aria-atomic="true" className="space-y-2 text-sm">
            {!state.ready && <p role="status">{copy.loading}</p>}
            {state.sending && <p role="status">{copy.statuses.queued}</p>}
            {generation && !state.sending && (generation.status === "failed"
                ? <StoryAgentFailure errorCode={generation.errorCode} canRecover={false} recovering={false} onRecover={() => undefined} />
                : <p role="status">{copy.statuses[generation.status]}</p>)}
            {generation && <p className="text-xs text-muted-foreground">{generation.provider && generation.model
                ? `${copy.actualModel}：${generation.provider} / ${generation.model}`
                : `${copy.frozenModel}：${generation.modelId}（${copy.modelPending}）`}</p>}
            {state.error && <>
                <StoryAgentFailure errorCode={null} message={state.error} canRecover={false} recovering={false} onRecover={() => undefined} />
                {!state.storageError && <Button size="sm" variant="outline" disabled={state.sending} onClick={() => void state.recover()}>{state.unknownRequest ? copy.recover : copy.reload}</Button>}
            </>}
        </div>
        {state.artifact?.current && <DeepReadVersions artifact={state.artifact} api={api} storyId={storyId} />}
    </section>;
}
