import { PassThrough } from "node:stream";
import { createPiAiOpenAICompletionsModel, defaultPiAiClient } from "@cosmos/agent-pi-ai";
import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SNAPSHOT_COMMIT, SYNTHETIC_CREDENTIAL, readCredentialWithoutEcho, validateRunnerInvocation, runOfflineSmoke, runCli, requestPlan, prepareRealSmoke, validatePreparedRoot, withBoundedProviderTransport, createSafeDiagnostics } from "./connection-smoke.js";

describe("Task 39 Connection smoke input guard", () => {
    it("retains the first failure without serializing arbitrary errors or cleanup payloads", async () => {
        const diagnostics = createSafeDiagnostics();
        await expect(diagnostics.step("secret_write", async () => {
            throw Object.assign(new Error(SYNTHETIC_CREDENTIAL), { body: "private-provider-body" });
        })).rejects.toThrow(SYNTHETIC_CREDENTIAL);
        await expect(diagnostics.step("secret_delete", async () => {
            throw new Error("private-cleanup-message");
        })).rejects.toThrow();
        expect(diagnostics.record.firstFailure).toEqual({ stage: "secret_write", category: "operation_failed" });
        expect(diagnostics.record.status).toBe("failed");
        const text = JSON.stringify(diagnostics.record);
        for (const sensitive of [SYNTHETIC_CREDENTIAL, "private-provider-body", "private-cleanup-message"]) {
            expect(text).not.toContain(sensitive);
        }
    });

    it.each(["credential_input", "database_initialize", "connection_create", "secret_write", "dispatch",
        "result_write", "secret_delete", "disconnect"] as const)("records the fixed %s failure stage", async (stage) => {
        const diagnostics = createSafeDiagnostics();
        await expect(diagnostics.step(stage, async () => { throw new Error("private"); })).rejects.toThrow();
        expect(diagnostics.record.firstFailure).toEqual({ stage, category: "operation_failed" });
        expect(diagnostics.record.transportSends).toBe(0);
    });

    it("records safe response status without recording response content", async () => {
        const diagnostics = createSafeDiagnostics();
        let status: number | null = null;
        const transport = vi.fn<typeof fetch>(async () => new Response("private-response", { status: 401 }));
        await expect(diagnostics.step("dispatch", () => withBoundedProviderTransport(() =>
            fetch("https://api-slb.jiji.cc/v1/chat/completions", { method: "POST" }), transport,
            () => { diagnostics.record.transportSends += 1; }, (response) => { status = response.status; })))
            .resolves.toBeInstanceOf(Response);
        diagnostics.record.response = { returned: true, status };
        expect(diagnostics.record.response).toEqual({ returned: true, status: 401 });
        expect(JSON.stringify(diagnostics.record)).not.toContain("private-response");
    });

    it("counts an attempted transport even when the synthetic transport fails", async () => {
        const diagnostics = createSafeDiagnostics();
        const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error("private-network-message"));
        await expect(diagnostics.step("dispatch", () => withBoundedProviderTransport(() =>
            fetch("https://api-slb.jiji.cc/v1/chat/completions", { method: "POST" }), transport,
            () => { diagnostics.record.transportSends += 1; }))).rejects.toThrow();
        expect(diagnostics.record.transportSends).toBe(1);
        expect(diagnostics.record.firstFailure?.stage).toBe("dispatch");
        expect(JSON.stringify(diagnostics.record)).not.toContain("private-network-message");
    });
    it("bounds the installed SDK retries to one send and suppresses its console logs", async () => {
        const originalFetch = globalThis.fetch;
        const originalLog = process.env.OPENAI_LOG;
        process.env.OPENAI_LOG = "debug";
        const spies = ["debug", "info", "warn", "error"].map((level) =>
            vi.spyOn(console, level as "debug").mockImplementation(() => undefined));
        const transport = vi.fn<typeof fetch>(async (_input, init) => {
            expect(init?.redirect).toBe("error");
            expect(process.env.OPENAI_LOG).toBe("off");
            return new Response(JSON.stringify({ error: { message: "synthetic-private-response" } }), {
                status: 500, headers: { "content-type": "application/json", "retry-after-ms": "1" },
            });
        });
        try {
            await withBoundedProviderTransport(async () => {
                await defaultPiAiClient.complete(createPiAiOpenAICompletionsModel({
                    provider: "jijiapi", model: "gpt-6-luna", name: "test",
                    baseUrl: "https://api-slb.jiji.cc/v1", contextWindow: 262_144, maxTokens: 64,
                }), { messages: [{ role: "user", content: "Reply with exactly: OK", timestamp: 0 }] }, {
                    apiKey: SYNTHETIC_CREDENTIAL, maxTokens: 64, signal: AbortSignal.timeout(10_000),
                });
            }, transport);
            expect(transport).toHaveBeenCalledTimes(1);
            expect(spies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
            expect(globalThis.fetch).toBe(originalFetch);
            expect(process.env.OPENAI_LOG).toBe("debug");
        } finally {
            spies.forEach((spy) => spy.mockRestore());
            if (originalLog === undefined) delete process.env.OPENAI_LOG;
            else process.env.OPENAI_LOG = originalLog;
        }
    });

    it("rejects other destinations and restores globals after failure", async () => {
        const originalFetch = globalThis.fetch;
        const originalLog = process.env.OPENAI_LOG;
        const transport = vi.fn<typeof fetch>();
        await expect(withBoundedProviderTransport(() =>
            fetch("https://unapproved.invalid/v1/chat/completions", { method: "POST" }), transport))
            .rejects.toThrow("transport rejected");
        expect(transport).not.toHaveBeenCalled();
        expect(globalThis.fetch).toBe(originalFetch);
        expect(process.env.OPENAI_LOG).toBe(originalLog);
    });
    it("pins migration export to the reviewed immutable commit", () => {
        expect(SNAPSHOT_COMMIT).toBe("f66c33135351af38460fff73d311863dc7b4ef47");
    });

    it("deploys only frozen migrations and dispatches through real isolated Connection/SecretStore", async () => {
        const environmentBefore = { database: process.env.DATABASE_URL, root: process.env.COSMOS_DATA_ROOT };
        const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
            throw new Error("Network is forbidden in the offline smoke.");
        });
        try {
            const result = await runOfflineSmoke();
            expect(result).toMatchObject({ mode: "offline", status: "completed", migrationCount: 37,
                secretReads: 1, outputMatchesExpected: true, credentialAbsentFromOutput: true,
                missingSecretRejected: true, retained: true });
            expect(fetch).not.toHaveBeenCalled();
            expect({ database: process.env.DATABASE_URL, root: process.env.COSMOS_DATA_ROOT }).toEqual(environmentBefore);
            const manifest = JSON.parse(await readFile(join(result.isolatedRoot, "snapshot-manifest.json"), "utf8")) as {
                commit: string; files: Array<{ path: string; sha256: string }>;
            };
            expect(manifest.commit).toBe(SNAPSHOT_COMMIT);
            expect(manifest.files.filter((file) => file.path.endsWith("/migration.sql"))).toHaveLength(37);
            expect(manifest.files.some((file) => file.path.includes("20261008"))).toBe(false);
            expect(manifest.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);
            for (const name of ["result.json", "application.log.json", "migration.log"]) {
                const text = await readFile(join(result.isolatedRoot, name), "utf8");
                expect(text).not.toContain(SYNTHETIC_CREDENTIAL);
            }
        } finally {
            fetch.mockRestore();
        }
    }, 120_000);

    it("prepares an exact real request plan without credentials or network", async () => {
        const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network forbidden."));
        try {
            const result = await prepareRealSmoke();
            expect(result.status).toBe("prepared-no-request");
            expect(result.migrationCount).toBe(37);
            expect(await validatePreparedRoot(result.isolatedRoot)).toBe(result.isolatedRoot);
            expect(result.plan).toEqual(requestPlan(result.isolatedRoot));
            expect(result.plan.budget.maxOutputTokens).toBe(64);
            expect(result.plan.budget.maxDurationMs).toBe(300_000);
            expect(await readFile(join(result.isolatedRoot, "request-plan.json"), "utf8")).toContain("300000");
            expect(fetch).not.toHaveBeenCalled();
        } finally { fetch.mockRestore(); }
    }, 120_000);

    it("rejects real CLI execution in redirected tools before reading credentials", async () => {
        expect(process.stdin.isTTY === true && process.stdout.isTTY === true).toBe(false);
        await expect(runCli(["real", "unused-root"])).rejects.toThrow(/no credential was read/);
    });

    it("rejects unknown CLI arguments", async () => {
        await expect(runCli(["unexpected"])).rejects.toThrow(/credentials are never arguments/);
    });

    it("rejects redirected terminals before attempting to read input", async () => {
        const input = new PassThrough();
        await expect(readCredentialWithoutEcho(input as never, false)).rejects.toThrow(/no credential was read/);
        expect(input.listenerCount("data")).toBe(0);
    });

    it("rejects arguments and credential environment variables", () => {
        expect(() => validateRunnerInvocation({
            args: ["secret"],
            environment: {},
            inputIsTTY: true,
            outputIsTTY: true,
        })).toThrow(/no command-line arguments/);
        expect(() => validateRunnerInvocation({
            args: [],
            environment: { COSMOS_TEST_API_KEY: "present" },
            inputIsTTY: true,
            outputIsTTY: true,
        })).toThrow(/environment variables are not accepted/);
        expect(() => validateRunnerInvocation({
            args: [],
            environment: {},
            inputIsTTY: false,
            outputIsTTY: true,
        })).toThrow(/no credential was read/);
    });

    it("reads one submitted line with terminal raw mode enabled and always restores the mode", async () => {
        const input = new PassThrough() as PassThrough & {
            isTTY: boolean;
            setRawMode: (enabled: boolean) => void;
        };
        input.isTTY = true;
        const rawMode = vi.fn();
        input.setRawMode = rawMode;
        const pending = readCredentialWithoutEcho(input, true);
        input.write("test-secret\r");
        await expect(pending).resolves.toBe("test-secret");
        expect(rawMode.mock.calls).toEqual([[true], [false]]);
        expect(input.listenerCount("data")).toBe(0);
    });

    it("restores terminal mode after cancellation", async () => {
        const input = new PassThrough() as PassThrough & {
            isTTY: boolean;
            setRawMode: (enabled: boolean) => void;
        };
        input.isTTY = true;
        const rawMode = vi.fn();
        input.setRawMode = rawMode;
        const pending = readCredentialWithoutEcho(input, true);
        input.write("\u0003");
        await expect(pending).rejects.toThrow(/cancelled/);
        expect(rawMode.mock.calls).toEqual([[true], [false]]);
        expect(input.listenerCount("data")).toBe(0);
    });
});
