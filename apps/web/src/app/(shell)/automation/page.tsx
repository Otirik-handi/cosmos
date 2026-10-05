"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, RefreshCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import type { SourceSnapshot } from "@cosmos/contracts";

import { useSourceWorkspace } from "@/app/home/use-source-workspace";
import { useNoticeToast } from "@/app/home/use-notice-toast";
import { client } from "@/app/home/page-runtime";

import { Button } from "@/components/ui/button";
import { CollectionPlanList } from "@/components/cosmos/collection-plan-list";
import { ConnectionPanel } from "@/components/cosmos/connection-panel";
import { RunHistory } from "@/components/cosmos/run-history";
import {
    SourceForm,
    sourceFormSchema,
    type SourceFormValues,
} from "@/components/cosmos/source-form";
import { useLiveTopic } from "@/components/shell/live-provider";
import { messages } from "@/copy/messages";

/*
 * 自动化（PRD §8.5）：来源、采集计划、连接与运行记录。
 * 这一页从首页右栏与底部搬来，是「接一个新来源 → 试跑 → 看运行结果」的唯一入口。
 * 它不引入 feed / story workspace：useSourceWorkspace 只用到 feed 的 refresh 一个方法。
 *
 * 「来源表单开合」的状态**由 workspace 持有**（`showSourceForm`），本页不再自己 useState：
 * 保存成功后 workspace 会把它置回收起，两个所有者时本页那份永远不收起，会出现「回执说已保存、
 * 表单还开着、字段已被 reset 回示例值」的错位。
 */
export default function AutomationPage() {
    const [loading, setLoading] = useState(true);
    const [sources, setSources] = useState<readonly SourceSnapshot[]>([]);
    const [error, setError] = useState<string | null>(null);

    /** 写回执走 toast；`error` 仍由页面横幅显示。上下文对象身份稳定由 hook 保证。 */
    const { context: workspaceContext } = useNoticeToast(setError, setLoading);

    const sourceForm = useForm<SourceFormValues>({
        resolver: zodResolver(sourceFormSchema),
        defaultValues: {
            name: "",
            scheduleIntervalMinutes: "",
            connectionId: "",
            // 默认选中是 RSS，给它的必填字段一个可编辑的起始值。
            config: { feedUrl: "https://example.com/feed.xml" },
        },
    });

    const sourceWorkspace = useSourceWorkspace(
        workspaceContext,
        sourceForm,
        { error, loading, sources, setSources },
        // 来源变更后要让列表重读；本页没有 feed 列表，refresh 只用于满足签名。
        { refresh: async () => {} },
    );
    const {
        activatingPlanId,
        checkService,
        checkingService,
        connections,
        definitionState,
        deletePlan,
        deletingPlanId,
        loadDefinitions,
        loadPlans,
        plans,
        probeState,
        revokeWebhookEntry,
        rotateWebhookEntry,
        runMediaCleanup,
        runPlan,
        runRefreshToken,
        runningPlanId,
        saveMediaPolicy,
        selectDefinition,
        selectOperation,
        selectedDefinitionRef,
        selectedOperationId,
        onCreateSource,
        onTestSourceConfig,
        setShowSourceForm,
        showSourceForm,
        toggleActivation,
    } = sourceWorkspace;

    useEffect(() => {
        void loadDefinitions();
        void loadPlans().finally(() => setLoading(false));
    }, [loadDefinitions, loadPlans]);

    /** 运行事件只影响本页：重读计划与运行记录。 */
    useLiveTopic("automation", () => {
        void loadPlans();
    });

    const planList = (
        <CollectionPlanList
            activatingPlanId={activatingPlanId}
            connections={connections}
            deletingPlanId={deletingPlanId}
            onConfirmMediaCleanup={() => runMediaCleanup(false)}
            onDelete={deletePlan}
            onPreviewMediaCleanup={() => runMediaCleanup(true)}
            onRevokeWebhookEntry={revokeWebhookEntry}
            onRotateWebhookEntry={rotateWebhookEntry}
            onRun={runPlan}
            onSaveMediaPolicy={saveMediaPolicy}
            onToggleActivation={toggleActivation}
            plans={plans}
        />
    );

    return (
        <div className="flex w-full flex-col gap-5">
            <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-[15px] font-medium">{messages.automation.title}</h1>
                <span className="text-[12px] text-muted-foreground">
                    {messages.automation.description}
                </span>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                    <Button
                        disabled={checkingService}
                        onClick={() => void checkService()}
                        size="sm"
                        variant="outline"
                    >
                        <RefreshCcw data-icon="inline-start" />
                        {messages.automation.checkService}
                    </Button>
                    <Button onClick={() => setShowSourceForm((value) => !value)} size="sm">
                        {showSourceForm ? <X data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
                        {showSourceForm ? messages.automation.closeForm : messages.automation.newSource}
                    </Button>
                </div>
            </div>

            {error && (
                <div
                    className="rounded-[var(--radius-control)] border border-destructive/30 bg-destructive/10 p-3 text-[13px] leading-6 text-destructive"
                    role="alert"
                >
                    {error}
                </div>
            )}

            {showSourceForm && (
                <SourceForm
                    connections={connections}
                    definitionState={definitionState}
                    form={sourceForm}
                    onRetryDefinition={() => void loadDefinitions()}
                    onSelectDefinition={selectDefinition}
                    onSelectOperation={selectOperation}
                    onSubmit={onCreateSource}
                    onTest={() => void onTestSourceConfig()}
                    probeState={probeState}
                    selectedDefinitionRef={selectedDefinitionRef}
                    selectedOperationId={selectedOperationId}
                />
            )}

            <section aria-label={messages.automation.plans} className="flex flex-col gap-3">
                <h2 className="text-[15px] font-medium">{messages.automation.plans}</h2>
                {planList}
            </section>

            <section aria-label={messages.automation.connections} className="flex flex-col gap-3">
                <h2 className="text-[15px] font-medium">{messages.automation.connections}</h2>
                <ConnectionPanel client={client} onConnectionsChanged={() => void loadPlans()} />
            </section>

            <section aria-label={messages.automation.runHistory} className="flex flex-col gap-3">
                <h2 className="text-[15px] font-medium">{messages.automation.runHistory}</h2>
                <RunHistory client={client} refreshToken={runRefreshToken} />
            </section>
        </div>
    );
}
