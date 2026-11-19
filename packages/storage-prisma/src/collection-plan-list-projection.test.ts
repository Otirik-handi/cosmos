import { expect, it } from "vitest";
import type { Prisma, PrismaClient } from "@prisma/client";
import { createFixtureSource, withRepository } from "./index.fixtures.js";

/** 观测到的 SQL 事件：`params` 是 Prisma 序列化后的参数串，用它判断查询有没有设行数上限。 */
type QueryEventRecord = { query: string; params: string };

/**
 * 计划列表的批量投影（T04 list-collection-plans 切片）。
 *
 * `listCollectionPlans()` 原本逐计划查 legacy Run 与 WorkflowRun，实测每个计划 2 次、
 * 合计 3 + 2N（1 个计划 5 次、3 个 9 次、5 个 13 次）。列表是产品面常驻读，这里把两类运行行
 * 也按计划 id 集合批量取回，使查询次数与计划数无关。
 */
function watchQueries(prisma: PrismaClient): {
    events: readonly QueryEventRecord[];
    reset: () => void;
} {
    const events: QueryEventRecord[] = [];
    const client: PrismaClient<Prisma.PrismaClientOptions, "query"> = prisma as PrismaClient<
        Prisma.PrismaClientOptions,
        "query"
    >;
    client.$on("query", (event) => {
        events.push({ query: event.query, params: event.params });
    });
    return {
        events,
        reset: () => {
            events.length = 0;
        },
    };
}

function countQueries(prisma: PrismaClient): {
    measure: (operation: () => Promise<unknown>) => Promise<number>;
    lastEvents: () => readonly QueryEventRecord[];
} {
    const watcher = watchQueries(prisma);
    let last: readonly QueryEventRecord[] = [];
    return {
        lastEvents: () => last,
        async measure(operation) {
            watcher.reset();
            await operation();
            last = [...watcher.events];
            return last.length;
        },
    };
}

/** 只留下读两张运行表的查询；Prisma 生成的 SQL 带反引号与 `main.` 前缀，这里统一归一化。 */
function readRunHistoryQueries(events: readonly QueryEventRecord[]): readonly QueryEventRecord[] {
    return events.filter((event) => /FROM\s+(?:main\.)?["`]?(?:WorkflowRun|Run)["`]?\b/.test(
        event.query.replace(/[`"]/g, ""),
    ));
}

/**
 * Prisma 把「不设上限」编码成 `LIMIT ?` 加参数 -1。命中它意味着这些历史行会被整批读回内存，
 * 只为每组留一条——行数上界于是取决于历史长度，而不是计划数。
 */
function readsUnboundedRunRows(events: readonly QueryEventRecord[]): readonly QueryEventRecord[] {
    return events.filter((event) => /(?:^|[[,\s])-1\b/.test(event.params));
}

/**
 * 多轮采样取最小值。
 *
 * CI 上这个计数偶发比本地多 1（两个方向都出现过），而 Prisma 的 query 事件在 `await`
 * 返回时已同步送达，`listCollectionPlans` 也没有未 await 的查询——多出来的只能来自测量
 * 窗口里的连接层噪声（连接重建、SQLite busy 重试之类）。噪声只会抬高计数，所以取多轮
 * 的最小值得到真实次数；如果每轮都偏，min 依然失败并把两轮 SQL 打出来。
 */
async function measureMinimum(
    counter: ReturnType<typeof countQueries>,
    operation: () => Promise<unknown>,
    rounds = 3,
): Promise<number> {
    let minimum = Number.POSITIVE_INFINITY;
    for (let round = 0; round < rounds; round += 1) {
        minimum = Math.min(minimum, await counter.measure(operation));
    }
    return minimum;
}

it("lists plans with a query count that does not grow with the number of plans", async () => {
    await withRepository("plan-list-projection-queries", async (repository, prisma) => {
        const counter = countQueries(prisma);
        await createFixtureSource(repository, { name: "第一个计划", config: {} });
        const single = await measureMinimum(counter, () => repository.listCollectionPlans());
        const singleEvents = counter.lastEvents();

        for (const name of ["第二个", "第三个", "第四个", "第五个"]) {
            await createFixtureSource(repository, { name, config: {} });
        }
        const many = await measureMinimum(counter, () => repository.listCollectionPlans());
        const manyEvents = counter.lastEvents();

        // 临时诊断：计数不一致时打印两轮实际 SQL，定位多出来的那一条。
        if (many !== single) {
            const summarize = (events: readonly QueryEventRecord[]): readonly string[] =>
                events.map((event) => event.query.replace(/\s+/g, " ").trim().slice(0, 120));
            console.log(`[diag-count] single=${single} ${JSON.stringify(summarize(singleEvents))}`);
            console.log(`[diag-count] many=${many} ${JSON.stringify(summarize(manyEvents))}`);
        }

        // 结论：查询次数只与读的表有关，与计划数无关。
        expect(many).toBe(single);
        // 上界把「批发」钉死：计划表（含触发器与来源）、Run、WorkflowRun 各至多一批。
        expect(many).toBeLessThanOrEqual(6);
        expect(single).toBeGreaterThanOrEqual(1);
    }, { clientOptions: { log: [{ emit: "event", level: "query" }] } });
});

it("bounds the run rows it reads by the number of plans, not by their history", async () => {
    await withRepository("plan-list-projection-row-bound", async (repository, prisma) => {
        const watcher = watchQueries(prisma);
        // 两个计划的历史长度与时间带都不对称：只取「全局最新 N 行」的假批量会让历史短但
        // 更近的计划独占结果，长历史的计划反而丢掉最新一条。行数有界必须真的按计划分组。
        const plans: Array<{ planId: string; sourceId: string; name: string; historyLength: number; month: number }> = [];
        for (const spec of [
            { name: "历史很长的计划 A", historyLength: 40, month: 2 },
            { name: "历史很短的计划 B", historyLength: 3, month: 3 },
        ]) {
            const source = await createFixtureSource(repository, { name: spec.name, config: {} });
            plans.push({
                planId: source.planId,
                sourceId: source.id,
                name: spec.name,
                historyLength: spec.historyLength,
                month: spec.month,
            });
        }
        for (const plan of plans) {
            for (let index = 0; index < plan.historyLength; index += 1) {
                const createdAt = new Date(Date.UTC(2026, plan.month, 1, 0, index));
                await prisma.run.create({
                    data: {
                        sourceInstanceId: plan.sourceId,
                        planId: plan.planId,
                        triggerKind: "manual",
                        status: "failed",
                        createdAt,
                        errorMessage: `legacy-${plan.name}-${index}`,
                    },
                });
                await prisma.workflowRun.create({
                    data: {
                        id: `plan-bounded-${plan.planId}-${index}`,
                        stateJson: "{}",
                        status: "failed",
                        sourceInstanceId: plan.sourceId,
                        planId: plan.planId,
                        errorMessage: `workflow-${plan.name}-${index}`,
                        definitionKey: "cosmos.ingest",
                        definitionVersion: "1",
                        manifestHash: "builtin:cosmos.ingest@1",
                        createdAt,
                        updatedAt: createdAt,
                    },
                });
            }
        }

        watcher.reset();
        const listed = await repository.listCollectionPlans();
        const historyQueries = readRunHistoryQueries(watcher.events);
        // 每张运行表一次查询，且都不允许把历史整批读回来。
        expect(historyQueries).toHaveLength(2);
        expect(readsUnboundedRunRows(historyQueries)).toEqual([]);
        expect(watcher.events.length).toBeLessThanOrEqual(6);
        // 行数有界不能靠丢行换：每个计划各自最新的一条仍要被选中（并列时 legacy 胜）。
        for (const plan of plans) {
            const snapshot = listed.find((candidate) => candidate.id === plan.planId)!;
            expect(snapshot.lastError).toBe(`legacy-${plan.name}-${plan.historyLength - 1}`);
            expect(snapshot.lastRunAt).toBe(
                new Date(Date.UTC(2026, plan.month, 1, 0, plan.historyLength - 1)).toISOString(),
            );
        }
    }, { clientOptions: { log: [{ emit: "event", level: "query" }] } });
});

it("projects every listed plan exactly like the single-plan read", async () => {
    await withRepository("plan-list-projection-parity", async (repository, prisma) => {
        for (const name of ["计划一", "计划二", "计划三"]) {
            const source = await createFixtureSource(repository, { name, config: {} });
            await prisma.run.create({
                data: {
                    sourceInstanceId: source.id,
                    planId: source.planId,
                    triggerKind: "manual",
                    status: "failed",
                    errorMessage: `only-${name}`,
                },
            });
        }
        const listed = await repository.listCollectionPlans();
        expect(listed).toHaveLength(3);
        for (const snapshot of listed) {
            await expect(repository.getCollectionPlan(snapshot.id)).resolves.toEqual(snapshot);
        }
    });
});

it("drops run rows that carry no plan id instead of failing the whole list", async () => {
    await withRepository("plan-list-projection-null-plan", async (repository, prisma) => {
        const source = await createFixtureSource(repository, { name: "唯一的计划", config: {} });
        // 归属为空的运行行不能算到任何一个计划头上。
        await prisma.workflowRun.create({
            data: {
                id: "orphan-workflow-run",
                stateJson: "{}",
                status: "failed",
                sourceInstanceId: null,
                planId: null,
                errorMessage: "不属于任何计划",
                definitionKey: "cosmos.ingest",
                definitionVersion: "1",
                manifestHash: "builtin:cosmos.ingest@1",
                createdAt: new Date(Date.UTC(2026, 4, 1)),
                updatedAt: new Date(Date.UTC(2026, 4, 1)),
            },
        });
        await prisma.run.create({
            data: {
                sourceInstanceId: source.id,
                planId: source.planId,
                triggerKind: "manual",
                status: "failed",
                errorMessage: "属于该计划",
            },
        });

        const listed = await repository.listCollectionPlans();
        expect(listed).toHaveLength(1);
        expect(listed[0]!.lastError).toBe("属于该计划");
    });
});
