import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    createSourceCommandSchema,
    type HealthResponse,
    type MediaCleanupReport,
    type SourceMediaPolicy,
    type SourceSnapshot,
} from "@cosmos/contracts";
import {
    CosmosTransportError,
} from "@cosmos/transport-http";
import {
    type ProbeState,
    type SourceDefinitionState,
} from "@/components/cosmos/source-form";
import {
    client,
    delay,
    readError,
    toSourceConfig,
    toScheduleIntervalMs,
    RSS_SOURCE_DEFINITION_REF,
    RSS_OPERATION_ID,
    PROBE_POLL_INTERVAL_MS,
    PROBE_POLL_TIMEOUT_MS,
} from "./page-runtime";
import type { UseFormReturn } from "react-hook-form";

import type { SourceFormValues } from "@/components/cosmos/source-form";
import type { WorkspaceContext } from "./page-bridge";

/** 由 G06 切片 4 从 page.tsx 拆出的域 hook（搬运，未改行为）。 */
export function useSourceWorkspace(
    ctx: WorkspaceContext,
    sourceForm: UseFormReturn<SourceFormValues>,
    shared: {
        error: string | null;
        loading: boolean;
        sources: readonly SourceSnapshot[];
        setSources: (next: readonly SourceSnapshot[]) => void;
    },
    feedApi: { refresh: () => Promise<void> },
) {
    const [health, setHealth] = useState<HealthResponse | null>(null);
    /** 共享加载态:入队/探测/看板等操作都会用到。 */
    const [runningSourceId, setRunningSourceId] = useState<string | null>(null);
    const [activatingSourceId, setActivatingSourceId] = useState<string | null>(null);
    const [deletingSourceId, setDeletingSourceId] = useState<string | null>(null);
    const [runRefreshToken, setRunRefreshToken] = useState(0);
    const [checkingService, setCheckingService] = useState(false);
    const [showSourceForm, setShowSourceForm] = useState(false);
    const [definitionState, setDefinitionState] = useState<SourceDefinitionState>({status: "loading"});
    const [probeState, setProbeState] = useState<ProbeState>({status: "idle"});
    const probeConfigKeyRef = useRef<string | null>(null);
    const sourceSummary = useMemo(() => {
        if (shared.sources.length === 0) {
            return "尚未配置来源";
        }
        return `${shared.sources.length} 个来源，${shared.sources.filter((source) => source.enabled).length} 个启用`;
    }, [shared.sources]);

    /** 表单字段由 catalog manifest 驱动；目录不可用时只提供重试，不回退硬编码字段。 */
    const loadDefinitions = useCallback(async (): Promise<void> => {
        setDefinitionState({status: "loading"});
        try {
            const definitions = await client.listSourceDefinitions();
            const manifest = definitions.find((item) => item.ref === RSS_SOURCE_DEFINITION_REF);
            if (!manifest) {
                setDefinitionState({status: "error", message: `目录中没有 ${RSS_SOURCE_DEFINITION_REF} 来源定义。`});
                return;
            }
            if (manifest.status !== "enabled") {
                setDefinitionState({status: "error", message: `来源定义 ${RSS_SOURCE_DEFINITION_REF} 当前不可用。`});
                return;
            }
            setDefinitionState({status: "ready", manifest});
        } catch (caught) {
            setDefinitionState({status: "error", message: readError(caught)});
        }
    }, []);

    // 测试结果只对提交时的配置有效；字段一变立即作废，避免旧结果误导保存决定。
    const watchedFeedUrl = sourceForm.watch("feedUrl");
    const watchedScheduleInterval = sourceForm.watch("scheduleIntervalMinutes");
    const onTestSourceConfig = async (): Promise<void> => {
        const valid = await sourceForm.trigger();
        if (!valid) {
            return;
        }
        const values = sourceForm.getValues();
        const config = toSourceConfig(values);
        probeConfigKeyRef.current = JSON.stringify(config);
        setProbeState({status: "running"});
        try {
            let snapshot = await client.createSourceConfigProbe({
                sourceDefinitionRef: RSS_SOURCE_DEFINITION_REF,
                operationId: RSS_OPERATION_ID,
                config,
            });
            const deadline = Date.now() + PROBE_POLL_TIMEOUT_MS;
            while (
                snapshot.status !== "succeeded"
                && snapshot.status !== "failed_terminal"
                && snapshot.status !== "cancelled"
            ) {
                if (Date.now() >= deadline) {
                    if (probeConfigKeyRef.current !== null) {
                        setProbeState({status: "timeout"});
                    }
                    return;
                }
                await delay(PROBE_POLL_INTERVAL_MS);
                snapshot = await client.getSourceConfigProbe(snapshot.id);
            }
            if (snapshot.status === "succeeded" && snapshot.result) {
                if (probeConfigKeyRef.current !== null) {
                    setProbeState({status: "succeeded", result: snapshot.result});
                }
                return;
            }
            if (probeConfigKeyRef.current !== null) {
                setProbeState({
                    status: "failed",
                    message: snapshot.error ?? "探测任务没有返回结果。",
                });
            }
        } catch (caught) {
            if (probeConfigKeyRef.current !== null) {
                setProbeState({status: "failed", message: readError(caught)});
            }
        }
    };

    const onCreateSource = sourceForm.handleSubmit(async (values) => {
        ctx.setError(null);
        try {
            await client.createSource(createSourceCommandSchema.parse({
                name: values.name,
                sourceDefinitionRef: RSS_SOURCE_DEFINITION_REF,
                operationId: RSS_OPERATION_ID,
                config: toSourceConfig(values),
                scheduleIntervalMs: toScheduleIntervalMs(values),
            }));
            ctx.setNotice("来源已保存，当前为停用状态；在“来源健康”列表中启用后开始抓取。");
            setShowSourceForm(false);
            sourceForm.reset();
            await feedApi.refresh();
        } catch (caught) {
            ctx.setError(readError(caught));
        }
    });

    const saveMediaPolicy = async (
        source: SourceSnapshot,
        policy: SourceMediaPolicy,
    ): Promise<void> => {
        ctx.setError(null);
        try {
            const nextConfig = { ...source.config, media: policy };
            await client.updateSource(source.id, {
                baseRevisionId: source.revisionId,
                config: nextConfig,
            });
            ctx.setNotice(`已保存 ${source.name} 的媒体策略；只影响之后的采集。`);
            await feedApi.refresh();
        } catch (caught) {
            if (caught instanceof CosmosTransportError && caught.status === 409) {
                ctx.setError("来源配置已被其它修改更新（版本冲突），列表已刷新，请重试。");
                await feedApi.refresh();
            }
            throw caught;
        }
    };

    /**
     * 保留期清理是显式的维护 Run（ADR-0015）：预览用 dryRun，确认才删除字节。
     * Worker 异步执行，这里轮询到终态再回报结果。
     */
    const runMediaCleanup = async (dryRun: boolean): Promise<MediaCleanupReport> => {
        let snapshot = await client.createMediaCleanup(
            { dryRun },
            `web-media-cleanup:${dryRun ? "preview" : "confirm"}:${crypto.randomUUID()}`,
        );
        const deadline = Date.now() + 30_000;
        while (snapshot.status === "queued" || snapshot.status === "running") {
            if (Date.now() > deadline) {
                throw new Error("清理任务超时，请稍后在运行记录中查看。");
            }
            await new Promise((resolve) => setTimeout(resolve, 1_000));
            snapshot = await client.getMediaCleanup(snapshot.runId);
        }
        if (snapshot.status !== "succeeded" || !snapshot.report) {
            throw new Error(snapshot.error ?? "清理任务失败。");
        }
        return snapshot.report;
    };

    const toggleActivation = async (source: SourceSnapshot, enabled: boolean): Promise<void> => {        setActivatingSourceId(source.id);
        ctx.setError(null);
        try {
            await client.activateSource(source.id, {
                enabled,
                baseRevisionId: source.revisionId,
            }, `web-activation:${source.id}:${source.revisionId}:${enabled ? "enable" : "disable"}`);
            ctx.setNotice(enabled
                ? `来源 ${source.name} 已启用；可执行手动录入，配置了定时的来源会自动抓取。`
                : `来源 ${source.name} 已停用，不再自动或手动抓取。`);
            await feedApi.refresh();
        } catch (caught) {
            if (caught instanceof CosmosTransportError && caught.status === 409) {
                ctx.setError("来源状态已被其它修改更新（版本冲突），列表已刷新，请重试。");
                await feedApi.refresh();
            } else {
                ctx.setError(readError(caught));
            }
        } finally {
            setActivatingSourceId(null);
        }
    };

    /**
     * 删除来源（AUT-001）。墓碑语义：来源从看板消失、调度停止，但已录入的条目与来源历史
     * 全部保留（Entry.sourceInstanceId 是必填级联外键，硬删会带走历史）。二次确认在
     * `SourceActions` 的两段按钮里，这里只负责发命令与刷新。
     */
    const deleteSource = async (source: SourceSnapshot): Promise<void> => {
        setDeletingSourceId(source.id);
        ctx.setError(null);
        try {
            await client.deleteSource(source.id, {
                baseRevisionId: source.revisionId,
                actor: "user",
                reason: "用户在看板删除来源",
            }, `web-deletion:${source.id}:${source.revisionId}`);
            ctx.setNotice(`来源 ${source.name} 已删除；已录入内容与来源历史保留。`);
            await feedApi.refresh();
        } catch (caught) {
            if (caught instanceof CosmosTransportError && caught.status === 409) {
                ctx.setError("来源已被其它修改更新（版本冲突），列表已刷新，请重试。");
                await feedApi.refresh();
            } else {
                ctx.setError(readError(caught));
            }
        } finally {
            setDeletingSourceId(null);
        }
    };

    const checkService = async (): Promise<void> => {
        if (checkingService) {
            return;
        }
        setCheckingService(true);
        ctx.setError(null);
        try {
            const result = await client.health();
            setHealth(result);
            ctx.setNotice(`服务正常，数据层 ${result.storageStatus}。`);
        } catch (caught) {
            ctx.setError(readError(caught));
        } finally {
            setCheckingService(false);
        }
    };

    const runSource = async (source: SourceSnapshot): Promise<void> => {
        setRunningSourceId(source.id);
        ctx.setError(null);
        try {
            const result = await client.triggerSource(source.id);
            ctx.setNotice(
                result.status === "queued" || result.status === "running"
                    ? `录入任务已排队（Run ${result.id}），Worker 完成后 Feed 会自动刷新。`
                    : `录入任务状态：${result.status}。`,
            );
            setRunRefreshToken((value) => value + 1);
            await feedApi.refresh();
        } catch (caught) {
            ctx.setError(readError(caught));
        } finally {
            setRunningSourceId(null);
        }
    };


    return {
        activatingSourceId,
        checkService,
        checkingService,
        definitionState,
        deleteSource,
        deletingSourceId,
        health,
        loadDefinitions,
        probeConfigKeyRef,
        setProbeState,
        onCreateSource,
        onTestSourceConfig,
        probeState,
        runMediaCleanup,
        runRefreshToken,
        runSource,
        runningSourceId,
        saveMediaPolicy,
        setShowSourceForm,
        showSourceForm,
        sourceSummary,
        toggleActivation,
    };
}
