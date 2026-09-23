import { BadRequestException, HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { createBuiltinManifestCatalog } from "@cosmos/application";
import {
    connectorStateExportSchema,
    type ConnectorStateExport,
} from "@cosmos/contracts";

import { AppController } from "./app.controller.js";
import { CONNECTOR_STATE_IMPORT_MAX_BODY_BYTES } from "./app.controller/sources.js";
import { SourceProbeService } from "./source-probe.service.js";

const exported: ConnectorStateExport = {
    schemaVersion: 1,
    exportedAt: "2026-09-23T12:30:00.000Z",
    scope: { kind: "attributed", value: null },
    counts: { namespaces: 1, keys: 1 },
    namespaces: [{
        namespace: "plan:source-1",
        owner: { planId: "plan:source-1", sourceId: "source-1", connectionId: null },
        entries: [{
            key: "http-cache",
            value: { etag: 'W/"1"' },
            version: 2,
            updatedAt: "2026-09-23T12:00:00.000Z",
        }],
    }],
};

function createController(repository: Record<string, unknown>): AppController {
    return new AppController(
        repository as never,
        new SourceProbeService(createBuiltinManifestCatalog()) as never,
    );
}

async function readBody(stream: NodeJS.ReadableStream): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk as Uint8Array));
    }
    return Buffer.concat(chunks).toString("utf8");
}

describe("AppController connector state export (ING-012 / ADR-0026)", () => {
    it("maps query parameters to one export scope and returns a downloadable JSON attachment", async () => {
        const repository = { exportConnectorState: vi.fn().mockResolvedValue(exported) };
        const controller = createController(repository);

        const file = await controller.exportConnectorState({ connectionId: "connection-1" });

        expect(repository.exportConnectorState)
            .toHaveBeenCalledWith({ kind: "connection", connectionId: "connection-1" });
        const headers = file.getHeaders();
        expect(headers.type).toBe("application/json");
        expect(headers.disposition)
            .toBe('attachment; filename="cosmos-connector-state-2026-09-23T12-30-00.000Z.json"');
        const body = await readBody(file.getStream());
        expect(body.endsWith("\n")).toBe(true);
        expect(connectorStateExportSchema.parse(JSON.parse(body))).toEqual(exported);
    });

    it("defaults to every attributed namespace and rejects more than one scope", async () => {
        const repository = { exportConnectorState: vi.fn().mockResolvedValue(exported) };
        const controller = createController(repository);

        await controller.exportConnectorState({});
        expect(repository.exportConnectorState).toHaveBeenCalledWith({ kind: "attributed" });

        const error = await controller
            .exportConnectorState({ planId: "plan:source-1", sourceId: "source-1" })
            .catch((value: unknown) => value);
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse())
            .toMatchObject({ code: "validation_failed" });
    });

    it("lists namespaces straight from the repository", async () => {
        const listed = [{
            namespace: "plan:source-1",
            keyCount: 1,
            planId: "plan:source-1",
            sourceId: "source-1",
            connectionId: null,
            unattributed: false,
        }];
        const repository = { listConnectorStateNamespaces: vi.fn().mockResolvedValue(listed) };
        const controller = createController(repository);

        await expect(controller.listConnectorStateNamespaces()).resolves.toEqual(listed);
    });
});

describe("AppController connector state import (ADR-0026)", () => {
    it("validates the export file and delegates the parsed command", async () => {
        const result = {
            mode: "overwrite" as const,
            namespaces: 1,
            created: 0,
            overwritten: 1,
            skipped: 0,
        };
        const repository = { importConnectorState: vi.fn().mockResolvedValue(result) };
        const controller = createController(repository);

        await expect(controller.importConnectorState(undefined, {
            mode: "overwrite",
            targetNamespace: "plan:source-2",
            export: exported,
        })).resolves.toEqual(result);
        expect(repository.importConnectorState).toHaveBeenCalledWith({
            mode: "overwrite",
            targetNamespace: "plan:source-2",
            export: exported,
        });
    });

    it("rejects a body that is not a connector state export", async () => {
        const repository = { importConnectorState: vi.fn() };
        const controller = createController(repository);

        const error = await controller
            .importConnectorState(undefined, { mode: "skip-existing", export: { schemaVersion: 2 } })
            .catch((value: unknown) => value);

        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse())
            .toMatchObject({ code: "validation_failed" });
        expect(repository.importConnectorState).not.toHaveBeenCalled();
    });

    it("rejects an oversized import before parsing it", async () => {
        const repository = { importConnectorState: vi.fn() };
        const controller = createController(repository);

        const declared = await controller
            .importConnectorState(String(CONNECTOR_STATE_IMPORT_MAX_BODY_BYTES + 1), { export: exported })
            .catch((value: unknown) => value);
        expect((declared as HttpException).getStatus()).toBe(413);
        expect((declared as HttpException).getResponse()).toMatchObject({ code: "payload_too_large" });

        // 没有 content-length 时按实际 body 判：契约上限不依赖头部。
        const measured = await controller
            .importConnectorState(undefined, { padding: "x".repeat(CONNECTOR_STATE_IMPORT_MAX_BODY_BYTES) })
            .catch((value: unknown) => value);
        expect((measured as HttpException).getStatus()).toBe(413);
        expect(repository.importConnectorState).not.toHaveBeenCalled();
    });
});
