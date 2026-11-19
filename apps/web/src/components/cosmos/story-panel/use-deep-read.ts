import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { deepReadGenerationRequestSchema, type ArtifactSnapshot, type DeepReadGeneration, type DeepReadGenerationRequest } from "@cosmos/contracts";
import { CosmosTransportError } from "@cosmos/transport-http";
import { client } from "@/app/home/page-runtime";
import { messages } from "@/copy/messages";

export type DeepReadClient = Pick<typeof client, "createStoryDeepRead" | "storyDeepReadGeneration" | "storyDeepReadArtifact" | "storyDeepReadRevision" | "revisionContent">;
const pendingSchema = z.object({ version: z.literal(1), key: z.string().min(1), request: deepReadGenerationRequestSchema, runId: z.string().min(1).nullable() }).strict();
type Pending = z.infer<typeof pendingSchema>;
const copy = messages.reading.deepRead;
export const deepReadStorageKey = (storyId: string) => `cosmos.story-deep-read.v1:${encodeURIComponent(storyId)}`;
export const isDeepReadActive = (value: DeepReadGeneration | null) => value?.status === "queued" || value?.status === "running";

export function deepReadHttpError(error: unknown): string {
    if (error instanceof CosmosTransportError) {
        if (error.status === 409) return copy.conflict;
        if (error.status === 400) return copy.invalid;
        if (error.status === 404) return copy.notFound;
        if (error.status === 503) return copy.unavailable;
    }
    return messages.reading.candidates.generationUnknown;
}

export function useDeepRead(storyId: string, api: DeepReadClient) {
    const [artifact, setArtifact] = useState<ArtifactSnapshot | null>(null);
    const [generation, setGeneration] = useState<DeepReadGeneration | null>(null);
    const [ready, setReady] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [storageError, setStorageError] = useState(false);
    const [unknownRequest, setUnknownRequest] = useState(false);
    const [pollAttempt, setPollAttempt] = useState(0);
    const pending = useRef<Pending | null>(null);
    const locked = useRef(false);
    const mounted = useRef(false);
    const storageKey = deepReadStorageKey(storyId);

    const persist = useCallback((record: Pending | null) => {
        try {
            if (record) sessionStorage.setItem(storageKey, JSON.stringify(record));
            else sessionStorage.removeItem(storageKey);
            pending.current = record;
            return true;
        } catch {
            if (mounted.current) setStorageError(true);
            return false;
        }
    }, [storageKey]);

    const refresh = useCallback(async () => {
        const result = await api.storyDeepReadArtifact(storyId);
        if (mounted.current) setArtifact(result.artifact);
        return result.artifact;
    }, [api, storyId]);

    const send = useCallback(async (record: Pending) => {
        // Preserve intent before any paid request, including replay after a lost response.
        if (!persist(record)) return;
        locked.current = true;
        setSending(true);
        setError(null);
        setUnknownRequest(false);
        try {
            const value = await api.createStoryDeepRead(storyId, record.request, record.key);
            const stored = persist({ ...record, runId: value.runId });
            if (!mounted.current) return;
            setGeneration(value);
            setPollAttempt((attempt) => attempt + 1);
            if (value.status === "completed") await refresh();
            if (!stored) setStorageError(true);
        } catch (caught) {
            if (!mounted.current) return;
            setError(deepReadHttpError(caught));
            if (caught instanceof CosmosTransportError && [400, 404, 409].includes(caught.status)) {
                persist(null);
                setUnknownRequest(false);
                if (caught.status === 409) {
                    const snapshot = await refresh();
                    if (mounted.current) setGeneration(snapshot?.generation ?? null);
                }
            } else setUnknownRequest(true);
        } finally {
            locked.current = false;
            if (mounted.current) setSending(false);
        }
    }, [api, persist, refresh, storyId]);

    useEffect(() => {
        mounted.current = true;
        let active = true;
        const boot = async () => {
            let record: Pending | null = null;
            try {
                const raw = sessionStorage.getItem(storageKey);
                record = raw === null ? null : pendingSchema.parse(JSON.parse(raw));
                pending.current = record;
            } catch { if (active) setStorageError(true); }
            try {
                const snapshot = await refresh();
                if (!active) return;
                if (record?.runId) {
                    const value = await api.storyDeepReadGeneration(storyId, record.runId);
                    if (active) setGeneration(value);
                    if (value.status === "completed") await refresh();
                } else if (record) await send(record);
                else setGeneration(snapshot?.generation ?? null);
            } catch { if (active) setError(copy.readFailed); }
            finally { if (active) setReady(true); }
        };
        void boot();
        return () => { active = false; mounted.current = false; };
    }, [api, refresh, send, storageKey, storyId]);

    const runId = generation?.runId;
    const activeGeneration = isDeepReadActive(generation);
    useEffect(() => {
        if (!runId || !activeGeneration) return;
        let active = true;
        let timer: ReturnType<typeof setTimeout>;
        const poll = async () => {
            try {
                const value = await api.storyDeepReadGeneration(storyId, runId);
                if (!active) return;
                setGeneration(value);
                if (value.status === "completed") await refresh();
                if (isDeepReadActive(value)) timer = setTimeout(() => void poll(), 1000);
            } catch { if (active) setError(copy.readFailed); }
        };
        timer = setTimeout(() => void poll(), 1000);
        return () => { active = false; clearTimeout(timer); };
    }, [activeGeneration, api, pollAttempt, refresh, runId, storyId]);

    const start = (request: DeepReadGenerationRequest = {}) => {
        if (!ready || storageError || sending || locked.current || activeGeneration || unknownRequest) return;
        return send({ version: 1, key: crypto.randomUUID(), request, runId: null });
    };
    const recover = async () => {
        if (locked.current || storageError) return;
        if (unknownRequest && pending.current) return send(pending.current);
        try {
            const snapshot = await refresh();
            const value = pending.current?.runId
                ? await api.storyDeepReadGeneration(storyId, pending.current.runId)
                : snapshot?.generation ?? generation;
            if (mounted.current) { setGeneration(value); setError(null); setPollAttempt((attempt) => attempt + 1); }
        } catch { if (mounted.current) setError(copy.readFailed); }
    };
    return { artifact, generation, ready, sending, active: activeGeneration || sending, start, recover,
        error: storageError ? messages.reading.candidates.recoveryUnavailable : error,
        unknownRequest, storageError };
}
