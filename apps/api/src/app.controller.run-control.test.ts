import { describe, expect, it, vi } from "vitest";
import { ConflictException, NotFoundException } from "@nestjs/common";

import {
    WorkflowHostConflictError,
    WorkflowHostError,
    type WorkflowEnvelope,
} from "@cosmos/application";
import { AppController } from "./app.controller.js";

function envelope(status: WorkflowEnvelope["status"]): WorkflowEnvelope {
    return {
        runId: "run-1",
        idempotencyKey: "k1",
        definition: { key: "cosmos.ingest", version: "1", manifestHash: "builtin:cosmos.ingest@1:source-snapshot-v2" },
        inputSnapshot: {},
        productRun: { status: "queued", sourceId: "source-1", triggerKind: "manual" },
        status,
        resumeRequired: false,
        createdAt: "2026-09-10T00:00:00.000Z",
        updatedAt: "2026-09-10T00:00:00.000Z",
        startedAt: null,
        finishedAt: null,
    };
}

function controllerWith(input: {
    cancel?: () => Promise<unknown>;
    recover?: () => Promise<unknown>;
    rerun?: () => Promise<unknown>;
}) {
    const workflowStore = {
        cancelWorkflowRun: input.cancel ?? vi.fn(),
        recoverWorkflowRun: input.recover ?? vi.fn(),
    };
    const workflowControl = input.rerun
        ? { rerun: input.rerun }
        : undefined;
    const controller = new AppController(
        {} as never,
        {} as never,
        undefined,
        workflowControl as never,
        workflowStore as never,
        undefined,
        undefined,
    );
    return { controller, workflowStore, workflowControl };
}

describe("AppController run control (RUN-004 / ADR-0016)", () => {
    it("cancelRun returns a cancelled result with reuse/sideEffects explanation", async () => {
        const { controller } = controllerWith({
            cancel: async () => envelope("cancelled"),
        });
        const result = await controller.cancelRun("run-1", {});
        expect(result).toMatchObject({
            action: "cancelled",
            run: { id: "run-1", status: "cancelled" },
        });
        expect(result.reuse).toBeTruthy();
        expect(result.sideEffects).toBeTruthy();
    });

    it("cancelRun maps a missing Run to 404 and a terminal Run to 409", async () => {
        const missing = controllerWith({
            cancel: async () => {
                throw new WorkflowHostError("not_found", "Workflow run missing was not found.");
            },
        });
        await expect(missing.controller.cancelRun("missing", {})).rejects.toBeInstanceOf(NotFoundException);

        const terminal = controllerWith({
            cancel: async () => {
                throw new WorkflowHostConflictError("Cannot cancel terminal Workflow run run-1 (completed).");
            },
        });
        await expect(terminal.controller.cancelRun("run-1", {})).rejects.toBeInstanceOf(ConflictException);
    });

    it("recoverRun returns a recovered result", async () => {
        const { controller } = controllerWith({
            recover: async () => envelope("running"),
        });
        const result = await controller.recoverRun("run-1", {});
        expect(result).toMatchObject({ action: "recovered", run: { id: "run-1" } });
    });

    it("rerunRun returns a rerun result for the fresh Run", async () => {
        const { controller } = controllerWith({
            rerun: async () => envelope("queued"),
        });
        const result = await controller.rerunRun("run-1", {}, "rerun-key");
        expect(result).toMatchObject({ action: "rerun", run: { id: "run-1", status: "queued" } });
    });

    it("rerunRun rejects when the durable host is not enabled", async () => {
        const { controller } = controllerWith({});
        await expect(controller.rerunRun("run-1", {}, "rerun-key")).rejects.toBeInstanceOf(ConflictException);
    });

    it("listRuns maps the durable Run list to RunSnapshots", async () => {
        const workflowStore = {
            listWorkflowRuns: vi.fn(async () => [envelope("failed")]),
        };
        const controller = new AppController(
            {} as never,
            {} as never,
            undefined,
            undefined,
            workflowStore as never,
            undefined,
            undefined,
        );
        const result = await controller.listRuns(undefined, "10");
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ id: "run-1", status: "failed" });
    });

    it("listRuns rejects when the durable host is not enabled", async () => {
        const controller = new AppController(
            {} as never,
            {} as never,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
        );
        await expect(controller.listRuns(undefined, "10")).rejects.toBeInstanceOf(ConflictException);
    });
});
