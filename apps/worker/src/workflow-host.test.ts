import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { ActionDefinition } from "@cosmos/contracts";
import {
    ActionRegistry,
    WorkflowActivityWorker,
    WorkflowCompletionDispatcher,
    WorkflowRunLane,
    type RegisteredAction,
} from "@cosmos/application";
import { FileBlobStore } from "@cosmos/blob-store";

import { createWorkflowHost } from "./workflow-host.js";

function definition(): ActionDefinition {
    return {
        ref: "composition.echo@1",
        kind: "transform",
        description: "Composition test action.",
        capabilities: ["test"],
        executionPlacement: "trusted_worker",
        inputSchema: z.object({ value: z.string() }),
        outputSchema: z.object({ value: z.string() }),
        execution: {
            idempotent: true,
            supportsCancellation: true,
            timeoutMs: null,
            retryPolicy: null,
        },
    };
}

function action(): RegisteredAction {
    return {
        definition: definition(),
        handler: async (input: unknown) => input,
    };
}

describe("Worker Workflow Host composition", () => {
    it("rejects an empty executable catalog before constructing a durable host", async () => {
        const root = await mkdtemp(join(tmpdir(), "cosmos-workflow-host-composition-"));
        try {
            expect(() => createWorkflowHost({
                prisma: {} as PrismaClient,
                blobs: new FileBlobStore({ root }),
                definitions: [],
                actions: [],
            })).toThrow(
                "COSMOS_WORKFLOW_HOST_ENABLED is reserved until this Worker registers its executable "
                    + "Workflow definitions and Actions; refusing to start an empty durable host.",
            );
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it("shares one durable backend, store, value store and executable registries", async () => {
        const root = await mkdtemp(join(tmpdir(), "cosmos-workflow-host-composition-"));
        const prisma = new PrismaClient({
            datasources: { db: { url: `file:${join(root, "composition.sqlite")}` } },
        });
        const workflow = {
            key: "composition.workflow",
            version: "1",
            manifestHash: "sha256:composition-workflow",
            run: async () => ({ ok: true }),
        };
        try {
            const composition = createWorkflowHost({
                prisma,
                blobs: new FileBlobStore({ root: join(root, "blobs") }),
                definitions: [workflow],
                actions: [action()],
                owner: "composition-worker",
            });

            expect(composition.backend.prisma).toBe(prisma);
            expect(composition.store.prisma).toBe(prisma);
            expect(composition.definitions.resolve({
                key: workflow.key,
                version: workflow.version,
                manifestHash: workflow.manifestHash,
            })).toBe(workflow);
            expect(composition.actions).toBeInstanceOf(ActionRegistry);
            expect(composition.runLane).toBeInstanceOf(WorkflowRunLane);
            expect(composition.activityWorker).toBeInstanceOf(WorkflowActivityWorker);
            expect(composition.completionDispatcher).toBeInstanceOf(WorkflowCompletionDispatcher);
        } finally {
            await prisma.$disconnect();
            await rm(root, { recursive: true, force: true });
        }
    });
});
