import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { ActionDefinition } from "@cosmos/contracts";

import {
    ActionExecutionError,
    ActionRegistry,
    type ActionExecutionContext,
    type HostActionExecutionFence,
} from "./action.js";

function context(signal = new AbortController().signal): ActionExecutionContext {
    return {
        idempotencyKey: "stable-key",
        signal,
    };
}

function definition(
    ref: ActionDefinition["ref"] = "demo.echo@1",
    executionPlacement: ActionDefinition["executionPlacement"] = "trusted_worker",
): ActionDefinition {
    return {
        ref,
        kind: "transform",
        description: "Echo input.",
        capabilities: ["demo:echo"],
        executionPlacement,
        inputSchema: z.object({ value: z.string() }),
        outputSchema: z.object({ echoed: z.string() }),
        execution: {
            idempotent: true,
            supportsCancellation: true,
            timeoutMs: null,
            retryPolicy: null,
        },
    };
}

function hostFence(): HostActionExecutionFence {
    return {
        workflowRunId: "run-1",
        kernelRevision: 4,
        activity: {
            key: "root#0",
            path: "root",
            seq: 0,
            kind: "action",
            fingerprint: "sha256:activity",
        },
        jobId: "job-1",
        attempt: 1,
        jobLeaseToken: "job-token",
        runLeaseToken: "run-token",
    };
}

describe("ActionRegistry", () => {
    it("resolves complete versioned refs and describes executable actions", () => {
        const registry = new ActionRegistry();
        registry.register(definition("demo.echo@2"), async () => ({ echoed: "two" }));
        registry.register(definition("demo.echo@1"), async () => ({ echoed: "one" }));

        expect(registry.resolve("demo.echo@1").definition.ref).toBe("demo.echo@1");
        expect(registry.resolve("demo.echo@2").definition.ref).toBe("demo.echo@2");
        expect(registry.descriptors().map((item) => item.ref)).toEqual([
            "demo.echo@1",
            "demo.echo@2",
        ]);
        expect(registry.descriptors()[0]).not.toHaveProperty("inputSchema");
    });

    it("rejects duplicate refs but allows independent versions", () => {
        const registry = new ActionRegistry();
        registry.register(definition("demo.echo@1"), async () => ({ echoed: "one" }));
        registry.register(definition("demo.echo@2"), async () => ({ echoed: "two" }));

        expect(() => registry.register(
            definition("demo.echo@1"),
            async () => ({ echoed: "duplicate" }),
        )).toThrow(/Duplicate action ref: demo\.echo@1/);
    });

    it("rejects invalid refs before lookup and reports unknown valid refs", () => {
        const registry = new ActionRegistry();

        expect(() => registry.resolve("demo.echo")).toThrowError(
            new ActionExecutionError(
                "invalid_action_ref",
                "Invalid action ref: demo.echo",
                false,
            ),
        );
        expect(() => registry.resolve("missing.echo@1")).toThrowError(
            new ActionExecutionError(
                "unknown_action",
                "Unknown action ref: missing.echo@1",
                false,
            ),
        );
    });

    it("requires an idempotency key and AbortSignal", async () => {
        const registry = new ActionRegistry();
        registry.register(definition(), async () => ({ echoed: "ok" }));

        await expect(registry.dispatch(
            "demo.echo@1",
            { value: "ok" },
            { idempotencyKey: "", signal: new AbortController().signal },
        )).rejects.toMatchObject({ code: "invalid_input", retryable: false });
        await expect(registry.dispatch(
            "demo.echo@1",
            { value: "ok" },
            { idempotencyKey: "key" } as ActionExecutionContext,
        )).rejects.toMatchObject({ code: "invalid_input", retryable: false });
    });

    it("requires a host fence and keeps it out of public Action contexts", async () => {
        const registry = new ActionRegistry();
        let observed: unknown;
        registry.register(definition("demo.host@1", "host"), async (_input, received) => {
            observed = received;
            return { echoed: "host" };
        });

        await expect(registry.dispatch(
            "demo.host@1",
            { value: "ok" },
            context(),
        )).rejects.toMatchObject({ code: "invalid_input", retryable: false });
        await expect(registry.dispatchHost(
            "demo.host@1",
            { value: "ok" },
            context(),
            hostFence(),
        )).resolves.toEqual({ echoed: "host" });
        expect(observed).toEqual({
            idempotencyKey: "stable-key",
            signal: expect.anything(),
            fence: hostFence(),
        });
    });

    it("validates input before dispatch and output after dispatch", async () => {
        const registry = new ActionRegistry();
        let invocationCount = 0;
        registry.register(definition(), async (input) => {
            invocationCount += 1;
            if (typeof input !== "object" || input === null || !("value" in input)) {
                throw new Error("schema did not validate input");
            }
            const value = input.value;
            if (typeof value !== "string") {
                throw new Error("schema did not validate value");
            }
            return { echoed: value };
        });

        await expect(registry.dispatch(
            "demo.echo@1",
            { value: "ok" },
            context(),
        )).resolves.toEqual({ echoed: "ok" });
        await expect(registry.dispatch(
            "demo.echo@1",
            { value: 42 },
            context(),
        )).rejects.toMatchObject({ code: "invalid_input", retryable: false });
        expect(invocationCount).toBe(1);

        const badOutput = new ActionRegistry();
        badOutput.register(definition(), async () => ({ unexpected: true }));
        await expect(badOutput.dispatch(
            "demo.echo@1",
            { value: "ok" },
            context(),
        )).rejects.toMatchObject({ code: "malformed_payload", retryable: false });
    });

    it("passes the exact idempotency key and AbortSignal to trusted handlers", async () => {
        const registry = new ActionRegistry();
        const controller = new AbortController();
        let observed: ActionExecutionContext | undefined;
        registry.register(definition(), async (_input, received) => {
            observed = received;
            return { echoed: "ok" };
        });

        await registry.dispatch(
            "demo.echo@1",
            { value: "ok" },
            { idempotencyKey: "stable-key", signal: controller.signal },
        );

        expect(observed).toEqual({
            idempotencyKey: "stable-key",
            signal: controller.signal,
        });
    });

    it("classifies handler errors without owning retry state", async () => {
        const retryable = new ActionRegistry();
        retryable.register(definition(), async () => {
            throw { code: "rate_limited", retryable: true, message: "slow down" };
        });
        await expect(retryable.dispatch(
            "demo.echo@1",
            { value: "ok" },
            context(),
        )).rejects.toMatchObject({
            code: "rate_limited",
            retryable: true,
            message: "slow down",
        });

        const failed = new ActionRegistry();
        failed.register(definition(), async () => {
            throw new Error("boom");
        });
        await expect(failed.dispatch(
            "demo.echo@1",
            { value: "ok" },
            context(),
        )).rejects.toMatchObject({
            code: "internal_error",
            retryable: false,
        });

        const actionError = new ActionRegistry();
        actionError.register(definition(), async () => {
            throw new ActionExecutionError("timeout", "timed out", true);
        });
        await expect(actionError.dispatch(
            "demo.echo@1",
            { value: "ok" },
            context(),
        )).rejects.toEqual(new ActionExecutionError("timeout", "timed out", true));
    });
});
