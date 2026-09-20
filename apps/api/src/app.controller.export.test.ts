import { describe, expect, it, vi } from "vitest";

import { createBuiltinManifestCatalog } from "@cosmos/application";
import { userDataExportSchema, type UserDataExport } from "@cosmos/contracts";
import { AppController } from "./app.controller.js";
import { SourceProbeService } from "./source-probe.service.js";

const payload: UserDataExport = {
    schemaVersion: 1,
    exportedAt: "2026-09-20T12:30:00.000Z",
    counts: {
        labels: 1,
        collections: 0,
        favorites: 0,
        annotations: 0,
        savedViews: 0,
        boards: 0,
        spotlightPlacements: 0,
        targets: 1,
    },
    data: {
        labels: [{
            id: "label-1",
            name: "关注",
            createdAt: "2026-09-20T12:00:00.000Z",
            updatedAt: "2026-09-20T12:00:00.000Z",
            assignedStories: [{ id: "story-a", title: "Story a" }],
            assignedEntries: [],
            assignedTopics: [],
        }],
        collections: [],
        favorites: [],
        annotations: [],
        savedViews: [],
        boards: [],
        spotlightPlacements: [],
        targets: [{ targetType: "story", targetId: "story-a", title: "Story a", webUrl: null }],
    },
};

async function readBody(stream: NodeJS.ReadableStream): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk as Uint8Array));
    }
    return Buffer.concat(chunks).toString("utf8");
}

describe("AppController user data export (LIB-008 / OPS-004)", () => {
    it("returns the export as a downloadable JSON attachment", async () => {
        const repository = { exportUserData: vi.fn().mockResolvedValue(payload) };
        const controller = new AppController(
            repository as never,
            new SourceProbeService(createBuiltinManifestCatalog()) as never,
        );

        const file = await controller.exportUserData();

        expect(repository.exportUserData).toHaveBeenCalledTimes(1);
        // 文件名里的 `:` 必须换掉，否则在 Windows 上无法保存。
        const headers = file.getHeaders();
        expect(headers.type).toBe("application/json");
        expect(headers.disposition)
            .toBe('attachment; filename="cosmos-user-data-2026-09-20T12-30-00.000Z.json"');

        const body = await readBody(file.getStream());
        expect(body.endsWith("\n")).toBe(true);
        expect(userDataExportSchema.parse(JSON.parse(body))).toEqual(payload);
    });
});
