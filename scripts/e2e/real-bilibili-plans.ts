import { PrismaClient } from "@prisma/client";

import {
    assertRunSucceeded,
    boundedItemCount,
    expectJsonObject,
    isRecord,
    readString,
    requestJson,
    waitForTerminalRun,
    type IsolatedStackRoot,
} from "./helpers.js";

/**
 * Task 33（ADR-0023）的真实来源验收：同一连接下的 hot / feed 两个 Bilibili 计划。
 *
 * 单来源路径（rss / aihot / bilibili-hot）只证明一条链路能真实抓取；本场景要证明同一采集
 * 账号下的两个计划各自的 Run、checkpoint 与最近一次运行状态互不覆盖。连接在这里既是
 * 「两个计划属于同一账号」的分组事实，也是登录态的**所有者**：OpenCLI profile 住在连接的
 * `configJson` 里（Proposal connection-login-lifecycle-v1 决定 1），来源配置不再带它。
 *
 * Bilibili connector 不产生游标（`fetchItems` 恒返回 `nextCursor: null`），所以这里能验证的
 * 是 checkpoint 行与归属按计划分开，而不是「两个游标值不同」。
 */
export interface BilibiliPlanAcceptanceOptions {
    apiPort: number;
    stack: IsolatedStackRoot;
    profile: string;
}

type PlanHandle = {
    label: string;
    sourceId: string;
    planId: string;
};

type PlanRun = PlanHandle & { runId: string };

export async function runBilibiliDualPlanAcceptance(
    options: BilibiliPlanAcceptanceOptions,
): Promise<string> {
    const apiBaseUrl = `http://127.0.0.1:${options.apiPort}/api/v1`;
    const connectionId = await createConnection(apiBaseUrl, options.profile);
    const hot = await createPlan(apiBaseUrl, connectionId, {
        label: "hot",
        name: "Explicit Bilibili hot plan",
        config: { mode: "hot", limit: 20 },
    });
    // 登录态归连接（Proposal connection-login-lifecycle-v1 决定 1）：profile 在连接上，不在来源配置里。
    const feed = await createPlan(apiBaseUrl, connectionId, {
        label: "feed",
        name: "Explicit Bilibili feed plan",
        config: { mode: "feed", limit: 20 },
    });
    if (hot.planId === feed.planId || hot.sourceId === feed.sourceId) {
        throw new Error("The two Bilibili plans must be distinct objects.");
    }
    await assertPlansShareConnection(apiBaseUrl, connectionId, [hot, feed]);

    // 两个 Run 串行：Browser Bridge 只有一个登录态，并发抓取会互相干扰浏览器窗口，
    // 那证明不了计划隔离。
    const runs: PlanRun[] = [];
    for (const plan of [hot, feed]) {
        runs.push({ ...plan, runId: await enqueueRun(apiBaseUrl, plan) });
    }
    const accepted: { run: PlanRun; itemCount: number }[] = [];
    for (const run of runs) {
        const label = `real bilibili ${run.label}`;
        const completed = await waitForTerminalRun(apiBaseUrl, run.runId, label);
        assertRunSucceeded(label, run.runId, completed);
        accepted.push({ run, itemCount: boundedItemCount(label, completed) });
    }
    await assertPlanDiagnostics(apiBaseUrl, [hot, feed]);
    await assertStorageIsolation(options.stack, [hot, feed], runs);

    return [
        `Real bilibili dual-plan acceptance passed: connection ${connectionId};`,
        ...accepted.map(
            ({ run, itemCount }) =>
                `${run.planId} (${run.label}) Run ${run.runId} with ${itemCount} items;`,
        ),
        "runs, checkpoints and plan diagnostics stayed per-plan.",
    ].join(" ");
}

async function createConnection(apiBaseUrl: string, profile: string): Promise<string> {
    const created = expectJsonObject(
        await requestJson(`${apiBaseUrl}/connections`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                name: "Explicit Bilibili connection",
                connectorId: "bilibili",
                // 适配器的非秘密配置（Proposal connection-login-lifecycle-v1 决定 1）。
                configJson: JSON.stringify({ profile }),
            }),
        }),
        201,
        "connection creation",
    );
    return readString(created, "id");
}

async function createPlan(
    apiBaseUrl: string,
    connectionId: string,
    input: { label: string; name: string; config: Record<string, unknown> },
): Promise<PlanHandle> {
    const created = expectJsonObject(
        await requestJson(`${apiBaseUrl}/sources`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                name: input.name,
                sourceDefinitionRef: "source.bilibili@1",
                operationId: "fetch",
                connectionId,
                config: input.config,
            }),
        }),
        201,
        `${input.label} plan creation`,
    );
    const plan: PlanHandle = {
        label: input.label,
        sourceId: readString(created, "id"),
        planId: readString(created, "planId"),
    };
    // 启用状态归计划（ADR-0023 决策 2）：写入口是计划端点，CAS 用计划的 revision。
    expectJsonObject(
        await requestJson(
            `${apiBaseUrl}/collection-plans/${encodeURIComponent(plan.planId)}`,
            {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    enabled: true,
                    baseRevisionId: readString(created, "planRevisionId"),
                }),
            },
        ),
        200,
        `${input.label} plan activation`,
    );
    return plan;
}

async function assertPlansShareConnection(
    apiBaseUrl: string,
    connectionId: string,
    plans: readonly PlanHandle[],
): Promise<void> {
    const listed = await requestJson(`${apiBaseUrl}/collection-plans`);
    if (listed.status !== 200 || !Array.isArray(listed.body)) {
        throw new Error(
            `Expected HTTP 200 with a plan array from the plan listing, got ${listed.status}: ${JSON.stringify(listed.body)}.`,
        );
    }
    for (const plan of plans) {
        const found = listed.body.find(
            (item) => isRecord(item) && item.id === plan.planId,
        );
        if (!isRecord(found) || found.connectionId !== connectionId) {
            throw new Error(
                `Plan ${plan.planId} (${plan.label}) is not listed under connection ${connectionId}.`,
            );
        }
    }
}

async function enqueueRun(apiBaseUrl: string, plan: PlanHandle): Promise<string> {
    const queued = expectJsonObject(
        await requestJson(
            `${apiBaseUrl}/sources/${encodeURIComponent(plan.sourceId)}/runs`,
            {
                method: "POST",
                headers: {
                    "idempotency-key": `real-bilibili-${plan.label}-${Date.now()}`,
                },
            },
        ),
        201,
        `${plan.label} Run enqueue`,
    );
    return readString(queued, "id");
}

async function assertPlanDiagnostics(
    apiBaseUrl: string,
    plans: readonly PlanHandle[],
): Promise<void> {
    for (const plan of plans) {
        const snapshot = expectJsonObject(
            await requestJson(
                `${apiBaseUrl}/collection-plans/${encodeURIComponent(plan.planId)}`,
            ),
            200,
            `${plan.label} plan read`,
        );
        if (typeof snapshot.lastRunAt !== "string" || snapshot.lastRunAt.length === 0) {
            throw new Error(
                `Plan ${plan.planId} (${plan.label}) has no lastRunAt after its own Run.`,
            );
        }
        if (snapshot.lastError !== null) {
            throw new Error(
                `Plan ${plan.planId} (${plan.label}) recorded an unexpected error: ${String(snapshot.lastError)}.`,
            );
        }
    }
}

/**
 * 归属隔离读的是落库事实，不是 API 自报。验收栈开着 workflow host，产品 Run 由
 * `WorkflowRun` 承载（legacy `Run` 行在这条路径上不产生），所以断言的是 WorkflowRun 与
 * Checkpoint 各自落在自己的计划与来源上。
 */
async function assertStorageIsolation(
    stack: IsolatedStackRoot,
    plans: readonly PlanHandle[],
    runs: readonly PlanRun[],
): Promise<void> {
    const prisma = new PrismaClient({
        datasources: {
            db: { url: `file:${stack.dataRoot.replaceAll("\\", "/")}/cosmos.sqlite` },
        },
    });
    try {
        for (const run of runs) {
            const workflowRun = await prisma.workflowRun.findUnique({
                where: { id: run.runId },
                select: { planId: true, sourceInstanceId: true },
            });
            if (
                !workflowRun
                || workflowRun.planId !== run.planId
                || workflowRun.sourceInstanceId !== run.sourceId
            ) {
                throw new Error(
                    `WorkflowRun ${run.runId} (${run.label}) is not attributed to its own plan: ${JSON.stringify(workflowRun)}.`,
                );
            }
        }
        for (const plan of plans) {
            const checkpoints = await prisma.checkpoint.findMany({
                where: { planId: plan.planId },
                select: { sourceInstanceId: true },
            });
            if (
                checkpoints.length !== 1
                || checkpoints[0]?.sourceInstanceId !== plan.sourceId
            ) {
                throw new Error(
                    `Plan ${plan.planId} (${plan.label}) must own exactly one checkpoint on its own source, got ${JSON.stringify(checkpoints)}.`,
                );
            }
        }
    } finally {
        await prisma.$disconnect();
    }
}
