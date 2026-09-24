import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import {
    recordSqliteDiagnostics,
    sqliteDiagnosticsEnabled,
} from "./sqlite-diagnostics.js";
import { createPrismaClient } from "./storage-root.js";
import { prepareDatabase, temporaryRoots } from "./index.fixtures.js";

/**
 * SQLite 并发诊断开关（Task 34）。
 *
 * 这些用例锁的是两件事：① 关掉时**零开销**（不注册 log 事件、不写任何输出）；
 * ② 打开时真的能从一次普通查询里拿到慢操作与 PRAGMA 环境事实——诊断的全部价值
 * 就在这两点，缺一个这套观测就是自欺。
 */

const diagnosticsKeys = [
    "COSMOS_SQLITE_DIAGNOSTICS",
    "COSMOS_SQLITE_DIAGNOSTICS_FILE",
    "COSMOS_SQLITE_SLOW_MS",
] as const;

const savedEnv = new Map<string, string | undefined>();
const extraRoots: string[] = [];

function setDiagnosticsEnv(values: Partial<Record<(typeof diagnosticsKeys)[number], string>>): void {
    for (const key of diagnosticsKeys) {
        if (!savedEnv.has(key)) {
            savedEnv.set(key, process.env[key]);
        }
        const value = values[key];
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
}

afterEach(async () => {
    for (const [key, value] of savedEnv) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
    savedEnv.clear();
    await Promise.all(extraRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("stays inert while the switch is off", async () => {
    setDiagnosticsEnv({});
    const dir = await mkdtemp(join(tmpdir(), "cosmos-sqlite-diag-off-"));
    extraRoots.push(dir);
    const file = join(dir, "diagnostics.jsonl");

    expect(sqliteDiagnosticsEnabled()).toBe(false);
    recordSqliteDiagnostics({ event: "should.not.appear" });
    await expect(readFile(file, "utf8")).rejects.toThrow();
});

it("writes one structured JSONL line per record when pointed at a file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cosmos-sqlite-diag-on-"));
    extraRoots.push(dir);
    const file = join(dir, "diagnostics.jsonl");
    setDiagnosticsEnv({ COSMOS_SQLITE_DIAGNOSTICS: "1", COSMOS_SQLITE_DIAGNOSTICS_FILE: file });

    recordSqliteDiagnostics({ level: "warn", event: "sqlite.slow_operation", durationMs: 4321 });

    const lines = (await readFile(file, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(record).toMatchObject({
        level: "warn",
        event: "sqlite.slow_operation",
        durationMs: 4321,
    });
    expect(typeof record.timestamp).toBe("string");
    expect(typeof record.pid).toBe("number");
    // 两侧都以 `apps/<app>/dist/main.js` 启动，标签必须能区分它们。
    expect(typeof record.service).toBe("string");
    expect(String(record.service)).toContain("/");
});

it("records a real query through the repository client and pins the pragma facts", async () => {
    const root = await mkdtemp(join(tmpdir(), "cosmos-sqlite-diag-db-"));
    temporaryRoots.push(root);
    prepareDatabase(root);
    const file = join(root, "diagnostics.jsonl");
    // 阈值 0 = 每条查询都记，这样用例不必去制造一次「真的慢」的查询。
    setDiagnosticsEnv({
        COSMOS_SQLITE_DIAGNOSTICS: "1",
        COSMOS_SQLITE_DIAGNOSTICS_FILE: file,
        COSMOS_SQLITE_SLOW_MS: "0",
    });

    const client = createPrismaClient(root);
    try {
        await client.$queryRawUnsafe("SELECT count(*) FROM sqlite_master");
        // 台账原本假设 WAL 与 busy_timeout「尚未显式配置」；实测 WAL 关闭、
        // busy_timeout 由 Prisma 引擎默认设为非零，所以这两条事实要留在证据里。
        const journal = await client.$queryRawUnsafe<Array<{ journal_mode: string }>>("PRAGMA journal_mode");
        const busy = await client.$queryRawUnsafe<Array<{ timeout: bigint }>>("PRAGMA busy_timeout");
        expect(journal[0]?.journal_mode).toBe("delete");
        expect(Number(busy[0]?.timeout)).toBeGreaterThan(0);
    } finally {
        await client.$disconnect();
    }

    const records = (await readFile(file, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records.some((record) => record.event === "sqlite.slow_operation")).toBe(true);
});
