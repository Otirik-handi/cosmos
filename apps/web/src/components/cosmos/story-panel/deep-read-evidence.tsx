import { useEffect, useRef, useState } from "react";
import type { EvidenceRefContract, StructuredContentViewContract } from "@cosmos/contracts";
import { ContentBlockReader } from "../content-block-reader";
import { DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { messages } from "@/copy/messages";
import type { DeepReadClient } from "./use-deep-read";

const copy = messages.reading.deepRead;

export function DeepReadEvidence({ evidence, api }: { evidence: EvidenceRefContract; api: DeepReadClient }) {
    const [view, setView] = useState<StructuredContentViewContract | null>(null);
    const [failed, setFailed] = useState(false);
    const [missingBlock, setMissingBlock] = useState(false);
    const body = useRef<HTMLDivElement>(null);
    useEffect(() => {
        let active = true;
        void api.revisionContent(evidence.entryRevisionId, evidence.representationVersion).then((result) => {
            if (!active) return;
            const representation = result.representation;
            if (result.entryId !== evidence.entryId || result.entryRevisionId !== evidence.entryRevisionId
                || !representation || representation.representationVersion !== evidence.representationVersion
                || representation.status === "failed" || result.evidenceStatus === "deleted" || result.evidenceStatus === "access-restricted") {
                setFailed(true);
                return;
            }
            setView(result);
        }).catch(() => { if (active) setFailed(true); });
        return () => { active = false; };
    }, [api, evidence]);
    useEffect(() => {
        if (!view || !evidence.blockId || !body.current) return;
        // Match identity directly, rather than interpolating an untrusted ID into a CSS selector.
        const target = Array.from(body.current.querySelectorAll<HTMLElement>("[data-block-id]"))
            .find((element) => element.dataset.blockId === evidence.blockId);
        if (!target) { queueMicrotask(() => setMissingBlock(true)); return; }
        target.dataset.deepReadHighlighted = "true";
        target.tabIndex = -1;
        target.scrollIntoView({ block: "center" });
        target.focus({ preventScroll: true });
    }, [evidence.blockId, view]);
    return <DialogContent className="top-0 right-0 left-auto h-dvh w-[min(640px,100vw)] max-w-full translate-x-0 translate-y-0 grid-rows-[auto_auto_auto_minmax(0,1fr)] rounded-none p-6 sm:max-w-[min(640px,100vw)]" showCloseButton={false}>
        <div className="flex items-start justify-between gap-4">
            <DialogTitle>{copy.evidence}</DialogTitle>
            <DialogClose render={<Button size="sm" variant="outline" />}>{copy.close}</DialogClose>
        </div>
        <DialogDescription>{copy.evidenceDescription}</DialogDescription>
        <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{messages.reading.candidates.sourceVersion(evidence.entryRevisionId, evidence.representationVersion)}</p>
        <div ref={body} className="min-w-0 overflow-y-auto [overflow-wrap:anywhere] [&_[data-deep-read-highlighted]]:rounded [&_[data-deep-read-highlighted]]:bg-primary/10 [&_[data-deep-read-highlighted]]:ring-2 [&_[data-deep-read-highlighted]]:ring-ring">
            <div aria-live="polite">
                {failed ? <p role="status">{copy.evidenceUnavailable}</p>
                    : !view ? <p role="status">{messages.reading.content.loading}</p>
                        : missingBlock ? <p role="status">{copy.blockUnavailable}</p> : null}
            </div>
            {view?.representation && <ContentBlockReader blocks={view.representation.blocks} assets={[]} />}
        </div>
    </DialogContent>;
}
