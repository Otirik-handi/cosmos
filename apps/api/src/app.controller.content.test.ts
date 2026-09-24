import { describe, expect, it, vi } from "vitest";
import { NotFoundException, StreamableFile } from "@nestjs/common";

import { AppController } from "./app.controller.js";

/** PNG magic bytes, so the assertion compares real binary rather than text. */
const content = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);

function controllerWith(repository: unknown) {
    return new AppController(
        repository as never,
        {} as never,
        undefined,
        undefined,
        undefined,
        undefined,
    );
}

async function readBytes(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk as Uint8Array));
    }
    return Buffer.concat(chunks);
}

/**
 * 本地媒体端点（契约 F）：Phase 2 只在仓储层验证过「已保存媒体能读回」，
 * 端点本身（content-type 与字节是否原样透出）没有断言。
 */
describe("AppController local media endpoint", () => {
    it("streams a stored asset with its mime type and exact bytes", async () => {
        const readAsset = vi.fn(async () => ({ content, mimeType: "image/png" }));
        const controller = controllerWith({ readAsset });

        const file = await controller.asset("asset-1");

        expect(readAsset).toHaveBeenCalledWith("asset-1");
        expect(file).toBeInstanceOf(StreamableFile);
        expect(file.getHeaders().type).toBe("image/png");
        expect((await readBytes(file.getStream())).equals(Buffer.from(content))).toBe(true);
    });

    it("maps an unknown assetId to 404", async () => {
        const controller = controllerWith({ readAsset: vi.fn(async () => null) });
        await expect(controller.asset("missing")).rejects.toBeInstanceOf(NotFoundException);
    });
});
