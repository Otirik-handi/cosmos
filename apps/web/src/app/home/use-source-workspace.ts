import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    createSourceCommandSchema,
    type CollectionPlanSnapshot,
    type CollectionPlanWebhookEntry,
    type ConnectionInstance,
    type HealthResponse,
    type MediaCleanupReport,
    type SourceMediaPolicy,
    type SourceSnapshot,
} from "@cosmos/contracts";
import {
    CosmosTransportError,
} from "@cosmos/transport-http";
import {
    readManifestFields,
    toConfigFromFields,
    validateManifestFields,
    type ProbeState,
    type SourceDefinitionState,
} from "@/components/cosmos/source-form";
import {
    client,
    delay,
    readError,
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
    const [runningPlanId, setRunningPlanId] = useState<string | null>(null);
    const [activatingPlanId, setActivatingPlanId] = useState<string | null>(null);
    const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null);
    const [runRefreshToken, setRunRefreshToken] = useState(0);
    const [checkingService, setCheckingService] = useState(false);
    const [showSourceForm, setShowSourceForm] = useState(false);
    const [definitionState, setDefinitionState] = useState<SourceDefinitionState>({status: "loading"});
    /** 表单当前选中的来源定义；默认 RSS（唯一无需额外前置条件的定义）。 */
    const [selectedDefinitionRef, setSelectedDefinitionRef] = useState<string>(RSS_SOURCE_DEFINITION_REF);
    const [probeState, setProbeState] = useState<ProbeState>({status: "idle"});
    const [plans, setPlans] = useState<readonly CollectionPlanSnapshot[]>([]);
    const [connections, setConnections] = useState<readonly ConnectionInstance[]>([]);
    const probeConfigKeyRef = useRef<string | null>(null);
    const planSummary = useMemo(() => {
        if (plans.length === 0) {
            return "尚未配置采集计划";
        }
        return `${plans.length} 个采集计划，${plans.filter((plan) => plan.enabled).length} 个启用`;
    }, [plans]);

    /**
     * 产品面的对象是采集计划（ADR-0023 决策 5），列表与表单的连接选择都读它；
     * 连接名要在分组标题里显示，所以两个列表一起取。
     */
    const loadPlans = useCallback(async (): Promise<void> => {
        try {
            const [nextPlans, nextConnections] = await Promise.all([
                client.listCollectionPlans(),
                client.listConnections(),
            ]);
            setPlans(nextPlans);
            setConnections(nextConnections);
        } catch (caught) {
            ctx.setError(readError(caught));
        }
    }, [ctx]);

    /**
     * 首屏加载在 effect 内直接发起：`react-hooks/set-state-in-effect` 会把 effect 直接调用的
     * 局部 async 函数内联展开，把 `await` 之后的 setState 判成同步 setState；setState 落在
     * `.then` 回调里才会被认成异步（同 connection-panel）。cancelled 守卫同时挡掉卸载后的写入。
     */
    useEffect(() => {
        let cancelled = false;
        void Promise.all([
            client.listCollectionPlans(),
            client.listConnections(),
        ])
            .then(([nextPlans, nextConnections]) => {
                if (cancelled) return;
                setPlans(nextPlans);
                setConnections(nextConnections);
            })
            .catch((caught: unknown) => {
                if (cancelled) return;
                ctx.setError(readError(caught));
            });
        return () => {
            cancelled = true;
        };
    }, [ctx]);

    /**
     * 表单字段由 catalog manifest 驱动；目录不可用时只提供重试，不回退硬编码字段。
     * 目录里可能有多个来源定义（rss / bilibili / aihot），全部保留供表单选择。
     */
    const loadDefinitions = useCallback(async (): Promise<void> => {
        setDefinitionState({status: "loading"});
        try {
            const definitions = await client.listSourceDefinitions();
            const enabled = definitions.filter((item) => item.status === "enabled");
            if (enabled.length === 0) {
                setDefinitionState({status: "error", message: "目录里没有可用的来源定义。"});
                return;
            }
            setDefinitionState({status: "ready", manifests: enabled});
        } catch (caught) {
            setDefinitionState({status: "error", message: readError(caught)});
        }
    }, []);

    /** 当前来源定义与它的字段规则；字段规则同时驱动校验与 config 构造。 */
    const selectedManifest = definitionState.status === "ready"
        ? definitionState.manifests.find((item) => item.ref === selectedDefinitionRef) ?? null
        : null;
    const manifestFields = useMemo(
        () => (selectedManifest ? readManifestFields(selectedManifest) : []),
        [selectedManifest],
    );

    /** 换来源定义就整组重置配置字段：旧定义的字段值对新定义没有意义。 */
    const selectDefinition = useCallback((ref: string): void => {
        setSelectedDefinitionRef(ref);
        sourceForm.setValue("config", {});
        setProbeState({status: "idle"});
        probeConfigKeyRef.current = null;
    }, [sourceForm]);

    // 测试结果只对提交时的配置有效；字段一变立即作废，避免旧结果误导保存决定。
    const watchedConfig = sourceForm.watch("config");
    const watchedScheduleInterval = sourceForm.watch("scheduleIntervalMinutes");
    const onTestSourceConfig = async (): Promise<void> => {
        const valid = await sourceForm.trigger();
        if (!valid || !selectedManifest) {
            return;
        }
        const values = sourceForm.getValues();
        const config = toConfigFromFields(manifestFields, values.config);
        probeConfigKeyRef.current = JSON.stringify(config);
        setProbeState({status: "running"});
        try {
            let snapshot = await client.createSourceConfigProbe({
                sourceDefinitionRef: selectedManifest.ref,
                operationId: selectedManifest.operationIds[0] ?? RSS_OPERATION_ID,
                config,
                // 未保存配置的探测也要给连接（Proposal connection-login-lifecycle-v1 决定 1）：
                // `feed` 这类需要登录态的操作靠它拿 profile；没选连接就是 null。
                connectionId: values.connectionId === "" ? null : values.connectionId,
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
        if (!selectedManifest) {
            ctx.setError("目录里没有可用的来源定义，无法保存计划。");
            return;
        }
        // 字段级校验先跑：能从 JSON Schema 判断的规则在本地就报，不发给服务端。
        // 更细的规则（如 Bilibili 的条件必填）由服务端 canonical schema 裁决并回显。
        const fieldErrors = validateManifestFields(manifestFields, values.config);
        if (Object.keys(fieldErrors).length > 0) {
            for (const [field, message] of Object.entries(fieldErrors)) {
                sourceForm.setError(`config.${field}` as "config", {message});
            }
            ctx.setError("目标配置有未填写或不合法的字段，请按提示修正。");
            return;
        }
        try {
            await client.createSource(createSourceCommandSchema.parse({
                name: values.name,
                sourceDefinitionRef: selectedManifest.ref,
                operationId: selectedManifest.operationIds[0] ?? RSS_OPERATION_ID,
                config: toConfigFromFields(manifestFields, values.config),
                scheduleIntervalMs: toScheduleIntervalMs(values),
                connectionId: values.connectionId === "" ? null : values.connectionId,
            }));
            ctx.setNotice("采集计划已保存，当前为停用状态；在“采集计划”列表中启用后开始抓取。");
            setShowSourceForm(false);
            sourceForm.reset();
            await Promise.all([feedApi.refresh(), loadPlans()]);
        } catch (caught) {
            ctx.setError(readError(caught));
        }
    });

    const saveMediaPolicy = async (
        plan: CollectionPlanSnapshot,
        policy: SourceMediaPolicy,
    ): Promise<void> => {
        ctx.setError(null);
        try {
            // 媒体预算归采集计划（ADR-0023 决策 2）：写入口是计划端点，CAS 用计划自己的
            // revision；来源端点不再接受 config.media。
            await client.updateCollectionPlan(plan.id, {
                mediaPolicy: policy,
                baseRevisionId: plan.revisionId,
            });
            ctx.setNotice(`已保存 ${plan.name} 的媒体策略；只影响之后的采集。`);
            await Promise.all([feedApi.refresh(), loadPlans()]);
        } catch (caught) {
            if (caught instanceof CosmosTransportError && caught.status === 409) {
                ctx.setError("计划配置已被其它修改更新（版本冲突），列表已刷新，请重试。");
                await Promise.all([feedApi.refresh(), loadPlans()]);
            }
            throw caught;
        }
    };

    /**
     * Webhook 入口（ADR-0024）：生成/轮换返回**唯一一次**明文凭证，之后读投影只回答
     * 「已配置」；轮换会立即作废旧凭证，所以刷新计划列表让入口地址同步。
     */
    const rotateWebhookEntry = async (plan: CollectionPlanSnapshot): Promise<CollectionPlanWebhookEntry> => {
        ctx.setError(null);
        try {
            const entry = await client.rotateCollectionPlanWebhookEntry(plan.id);
            ctx.setNotice(`已为 ${plan.name} 生成 Webhook 入口；旧凭证（如果有）已立即失效。`);
            await loadPlans();
            return entry;
        } catch (caught) {
            ctx.setError(readError(caught));
            throw caught;
        }
    };

    const revokeWebhookEntry = async (plan: CollectionPlanSnapshot): Promise<void> => {
        ctx.setError(null);
        try {
            await client.revokeCollectionPlanWebhookEntry(plan.id);
            ctx.setNotice(`已撤销 ${plan.name} 的 Webhook 入口；需要重新生成才能再用。`);
            await loadPlans();
        } catch (caught) {
            ctx.setError(readError(caught));
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

    const toggleActivation = async (plan: CollectionPlanSnapshot, enabled: boolean): Promise<void> => {
        setActivatingPlanId(plan.id);
        ctx.setError(null);
        try {
            // 启用状态归采集计划（ADR-0023 决策 2），CAS 用计划自己的 revision。
            await client.updateCollectionPlan(plan.id, {
                enabled,
                baseRevisionId: plan.revisionId,
            });
            ctx.setNotice(enabled
                ? `计划 ${plan.name} 已启用；可执行手动录入，配置了定时的计划会自动抓取。`
                : `计划 ${plan.name} 已停用，不再自动或手动抓取。`);
            await Promise.all([feedApi.refresh(), loadPlans()]);
        } catch (caught) {
            if (caught instanceof CosmosTransportError && caught.status === 409) {
                ctx.setError("计划状态已被其它修改更新（版本冲突），列表已刷新，请重试。");
                await Promise.all([feedApi.refresh(), loadPlans()]);
            } else {
                ctx.setError(readError(caught));
            }
        } finally {
            setActivatingPlanId(null);
        }
    };

    /**
     * 删除计划（AUT-001）。v1 的删除仍是目标域命令（`DELETE /collection-plans/{id}` 是
     * Planned），所以用计划读投影上的 `sourceId`／`sourceRevisionId` 发它。墓碑语义：计划
     * 从看板消失、调度停止，但已录入的条目与来源历史全部保留（Entry.sourceInstanceId 是
     * 必填级联外键，硬删会带走历史）。二次确认在列表组件的两段按钮里。
     */
    const deletePlan = async (plan: CollectionPlanSnapshot): Promise<void> => {
        setDeletingPlanId(plan.id);
        ctx.setError(null);
        try {
            await client.deleteSource(plan.sourceId, {
                baseRevisionId: plan.sourceRevisionId,
                actor: "user",
                reason: "用户在看板删除采集计划",
            }, `web-deletion:${plan.sourceId}:${plan.sourceRevisionId}`);
            ctx.setNotice(`计划 ${plan.name} 已删除；已录入内容与来源历史保留。`);
            await Promise.all([feedApi.refresh(), loadPlans()]);
        } catch (caught) {
            if (caught instanceof CosmosTransportError && caught.status === 409) {
                ctx.setError("计划已被其它修改更新（版本冲突），列表已刷新，请重试。");
                await Promise.all([feedApi.refresh(), loadPlans()]);
            } else {
                ctx.setError(readError(caught));
            }
        } finally {
            setDeletingPlanId(null);
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

    const runPlan = async (plan: CollectionPlanSnapshot): Promise<void> => {
        setRunningPlanId(plan.id);
        ctx.setError(null);
        try {
            // v1 手动运行沿用目标域路由（计划级运行路由后置，见 API Draft §4.3）。
            const result = await client.triggerSource(plan.sourceId);
            ctx.setNotice(
                result.status === "queued" || result.status === "running"
                    ? `录入任务已排队（Run ${result.id}），Worker 完成后 Feed 会自动刷新。`
                    : `录入任务状态：${result.status}。`,
            );
            setRunRefreshToken((value) => value + 1);
            await Promise.all([feedApi.refresh(), loadPlans()]);
        } catch (caught) {
            ctx.setError(readError(caught));
        } finally {
            setRunningPlanId(null);
        }
    };


    return {
        activatingPlanId,
        checkService,
        checkingService,
        connections,
        definitionState,
        deletePlan,
        deletingPlanId,
        health,
        loadDefinitions,
        loadPlans,
        manifestFields,
        planSummary,
        plans,
        probeConfigKeyRef,
        selectDefinition,
        selectedDefinitionRef,
        selectedManifest,
        setProbeState,
        onCreateSource,
        onTestSourceConfig,
        probeState,
        revokeWebhookEntry,
        rotateWebhookEntry,
        runMediaCleanup,
        runRefreshToken,
        runPlan,
        runningPlanId,
        saveMediaPolicy,
        setShowSourceForm,
        showSourceForm,
        toggleActivation,
    };
}
