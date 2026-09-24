import { appendFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

/**
 * SQLite 并发诊断（Task 34，默认关闭）。
 *
 * 打开它是为了回答一个具体问题：整套浏览器验收里那几条「单跑通过、整套失败」的用例，
 * 能不能和 SQLite 的锁等待/失败事件在时间上对上号。为此只需要**观测**，不改并发形状、
 * 不改 journal mode、不改测试隔离。
 *
 * 关掉时零开销：不注册任何 Prisma log 事件，也不写任何输出。
 */

const slowOperationDefaultMs = 250;

export function sqliteDiagnosticsEnabled(): boolean {
    return process.env.COSMOS_SQLITE_DIAGNOSTICS === "1";
}

function slowOperationThresholdMs(): number {
    const raw = Number(process.env.COSMOS_SQLITE_SLOW_MS);
    return Number.isSafeInteger(raw) && raw >= 0 ? raw : slowOperationDefaultMs;
}

/**
 * 哪一侧在说话。API 与 Worker 都以 `apps/<app>/dist/main.js` 启动，只取 basename 会让
 * 两侧的记录都叫 `main.js`，而「慢操作来自 Worker 轮询还是 API 请求」正是判断争用成因的
 * 分水岭——所以取末三段，得到 `api/dist/main.js` 与 `worker/dist/main.js`。
 */
function serviceLabel(): string {
    const segments = (process.argv[1] ?? "").split(/[\\/]/).filter(Boolean);
    return segments.slice(-3).join("/") || "unknown";
}

/**
 * 一行一条 JSONL。默认写 stderr；给出 `COSMOS_SQLITE_DIAGNOSTICS_FILE` 时写文件——
 * 浏览器整套跑时 Playwright 会吞掉 webServer 的输出，只有文件能被事后 grep。
 */
export function recordSqliteDiagnostics(record: Record<string, unknown>): void {
    if (!sqliteDiagnosticsEnabled()) {
        return;
    }
    const line = `${JSON.stringify({
        timestamp: new Date().toISOString(),
        service: serviceLabel(),
        pid: process.pid,
        ...record,
    })}\n`;
    const file = process.env.COSMOS_SQLITE_DIAGNOSTICS_FILE?.trim();
    if (!file) {
        process.stderr.write(line);
        return;
    }
    try {
        appendFileSync(file, line);
    } catch {
        // 诊断写入失败不能影响业务路径：丢掉这一行，继续跑。
    }
}

/**
 * 诊断专用的客户端。构造与挂载写在同一个作用域里，`$on` 的 query/error/warn 重载
 * 才由 TS 自己推出来——否则要在这里做一次类型断言，而那条断言正是「开关关掉时也
 * 静默注册事件」的温床。
 *
 * `emit: "event"` 只回调、不打印，所以打开开关不会改变既有日志输出。
 */
export function createDiagnosedPrismaClient(url: string): PrismaClient {
    const threshold = slowOperationThresholdMs();
    const client = new PrismaClient({
        datasources: { db: { url } },
        log: [
            { emit: "event", level: "query" },
            { emit: "event", level: "error" },
            { emit: "event", level: "warn" },
        ],
    });
    client.$on("query", (event) => {
        if (event.duration < threshold) {
            return;
        }
        recordSqliteDiagnostics({
            level: "warn",
            event: "sqlite.slow_operation",
            durationMs: event.duration,
            target: event.target,
            query: event.query,
        });
    });
    client.$on("error", (event) => {
        recordSqliteDiagnostics({
            level: "error",
            event: "sqlite.error",
            target: event.target,
            message: event.message,
        });
    });
    client.$on("warn", (event) => {
        recordSqliteDiagnostics({
            level: "warn",
            event: "sqlite.warning",
            target: event.target,
            message: event.message,
        });
    });
    return client;
}

function firstValue(rows: ReadonlyArray<Record<string, unknown>>): unknown {
    return Object.values(rows[0] ?? {})[0];
}

/**
 * 每次运行记录一次环境事实。台账原本的假设是「WAL 与 busy_timeout 尚未显式配置」，
 * 实测是 `journal_mode=delete` 且 `busy_timeout=5000`（Prisma 引擎默认），所以这行输出
 * 必须留在证据里，而不是靠回忆。
 */
export async function recordSqlitePragmaFacts(client: PrismaClient): Promise<void> {
    if (!sqliteDiagnosticsEnabled()) {
        return;
    }
    // PRAGMA 会返回一行结果，只能用 queryRaw（executeRaw 报 P2010）。
    const [journal, busy, synchronous] = await Promise.all([
        client.$queryRawUnsafe<Array<Record<string, unknown>>>("PRAGMA journal_mode"),
        client.$queryRawUnsafe<Array<Record<string, unknown>>>("PRAGMA busy_timeout"),
        client.$queryRawUnsafe<Array<Record<string, unknown>>>("PRAGMA synchronous"),
    ]);
    recordSqliteDiagnostics({
        level: "info",
        event: "sqlite.pragma_facts",
        journalMode: firstValue(journal),
        busyTimeoutMs: Number(firstValue(busy)),
        synchronous: Number(firstValue(synchronous)),
        slowOperationThresholdMs: slowOperationThresholdMs(),
    });
}
