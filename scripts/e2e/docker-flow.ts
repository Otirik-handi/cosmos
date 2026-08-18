import { execFileSync } from "node:child_process";

const repositoryRoot = process.cwd();
const composeFile = "docker/compose.yml";
const composeArgs = ["compose", "-f", composeFile];
let composeStarted = false;

try {
    requireDocker();
    runDocker([...composeArgs, "up", "--build", "-d"]);
    composeStarted = true;

    await waitForHttp("http://127.0.0.1:4310/api/v1/health", 200, 180_000);
    await waitForHttp("http://127.0.0.1:3000", 200, 180_000);
    await waitForCondition(
        "Docker Worker heartbeat",
        async () => {
            const response = await fetch("http://127.0.0.1:4310/api/v1/health");
            if (!response.ok) return false;
            const body = (await response.json()) as Record<string, unknown>;
            return body.workerStatus === "ready";
        },
        180_000,
    );

    const source = await requestJson("http://127.0.0.1:4310/api/v1/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            name: "Docker fixture",
            kind: "fixture-rss",
            config: { fixturePath: "fixtures/rss/basic.xml" },
            enabled: true,
        }),
    });
    assertStatus(source, 201, "Docker source creation");
    const sourceId = readString(source.body, "id");

    const queued = await requestJson(
        `http://127.0.0.1:4310/api/v1/sources/${sourceId}/runs`,
        {
            method: "POST",
            headers: { "idempotency-key": "docker-flow-fixture-run" },
        },
    );
    assertStatus(queued, 201, "Docker fixture Run enqueue");
    const runId = readString(queued.body, "id");

    await waitForCondition(
        "Docker fixture Run succeeded",
        async () => {
            const result = await requestJson(
                `http://127.0.0.1:4310/api/v1/runs/${runId}`,
            );
            return (
                result.status === 200 &&
                isRecord(result.body) &&
                result.body.status === "succeeded"
            );
        },
        180_000,
        500,
    );
    const feed = await requestJson(
        "http://127.0.0.1:4310/api/v1/feed?limit=10",
    );
    assertStatus(feed, 200, "Docker fixture Feed");
    if (
        !isRecord(feed.body) ||
        !Array.isArray(feed.body.items) ||
        feed.body.items.length < 3
    ) {
        throw new Error(
            "Docker fixture Feed did not contain at least three items.",
        );
    }
    process.stdout.write(
        "Docker acceptance passed: API, Web, Worker, fixture Run and Feed.\n",
    );
} finally {
    if (composeStarted) {
        runDocker([...composeArgs, "down", "--volumes", "--remove-orphans"]);
    }
}

function requireDocker(): void {
    try {
        execFileSync("docker", ["version"], {
            cwd: repositoryRoot,
            stdio: "inherit",
            windowsHide: true,
        });
    } catch (error) {
        throw new Error(
            `Docker acceptance requires a working Docker CLI/daemon. ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

function runDocker(args: readonly string[]): void {
    execFileSync("docker", [...args], {
        cwd: repositoryRoot,
        stdio: "inherit",
        windowsHide: true,
    });
}

async function requestJson(
    url: string,
    init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
    const response = await fetch(url, init);
    const text = await response.text();
    let body: unknown = null;
    if (text) {
        try {
            body = JSON.parse(text) as unknown;
        } catch {
            body = text;
        }
    }
    return { status: response.status, body };
}

function assertStatus(
    response: { status: number; body: unknown },
    expected: number,
    operation: string,
): void {
    if (response.status !== expected) {
        throw new Error(
            `${operation} expected HTTP ${expected}, got ${response.status}.`,
        );
    }
}

async function waitForHttp(
    url: string,
    expectedStatus: number,
    timeoutMs: number,
): Promise<void> {
    await waitForCondition(
        url,
        async () => {
            try {
                const response = await fetch(url);
                return response.status === expectedStatus;
            } catch {
                return false;
            }
        },
        timeoutMs,
        1_000,
    );
}

async function waitForCondition(
    description: string,
    predicate: () => boolean | Promise<boolean>,
    timeoutMs: number,
    intervalMs = 250,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(`Timed out waiting for ${description}.`);
}

function readString(value: unknown, key: string): string {
    if (
        !isRecord(value) ||
        typeof value[key] !== "string" ||
        value[key].length === 0
    ) {
        throw new Error(`Expected ${key} in response.`);
    }
    return value[key];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
