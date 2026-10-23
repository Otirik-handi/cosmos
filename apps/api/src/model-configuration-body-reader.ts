import type { IncomingMessage } from "node:http";
import { assertModelConfigurationWrite } from "./model-configuration-write-policy.js";

type Trust = Parameters<typeof assertModelConfigurationWrite>[0];
function failure(code: "forbidden_origin" | "invalid_input" | "payload_too_large"): Error {
    return Object.assign(new Error("Model configuration write rejected."), {
        code, status: code === "forbidden_origin" ? 403 : code === "payload_too_large" ? 413 : 400,
    });
}
export async function readModelConfigurationBody(request: IncomingMessage, trust: Trust): Promise<unknown> {
    const header = (name: string, duplicateCode: "forbidden_origin" | "invalid_input"): string | undefined => {
        const values: string[] = [];
        for (let index = 0; index < request.rawHeaders.length; index += 2) {
            if (request.rawHeaders[index]!.toLowerCase() === name) values.push(request.rawHeaders[index + 1]!);
        }
        if (values.length > 1) throw failure(duplicateCode);
        return values[0];
    };
    const chunks: Buffer[] = [];
    try {
        const metadata = {
            origin: header("origin", "forbidden_origin"), host: header("host", "forbidden_origin"),
            contentType: header("content-type", "invalid_input"), bodyBytes: 0,
        };
        assertModelConfigurationWrite(trust, metadata);
        if (header("content-encoding", "invalid_input") !== undefined) throw failure("invalid_input");
        return await new Promise<unknown>((resolve, reject) => {
            let bytes = 0;
            let settled = false;
            const cleanup = () => {
                request.off("data", data); request.off("end", end);
                request.off("aborted", aborted); request.off("error", aborted);
            };
            const stop = (code: "invalid_input" | "payload_too_large") => {
                if (settled) return;
                settled = true;
                chunks.length = 0;
                // Keep the stream paused so the caller can send a fixed response before closing it.
                request.pause();
                cleanup();
                reject(failure(code));
            };
            const data = (chunk: Buffer) => {
                if (!Buffer.isBuffer(chunk)) return stop("invalid_input");
                bytes += chunk.length;
                if (bytes > 32 * 1024) return stop("payload_too_large");
                chunks.push(chunk);
            };
            const aborted = () => stop("invalid_input");
            const end = () => {
                if (settled) return;
                settled = true;
                cleanup();
                try { resolve(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)))); }
                catch { reject(failure("invalid_input")); }
                finally { chunks.length = 0; }
            };
            request.on("data", data); request.once("end", end);
            request.once("aborted", aborted); request.once("error", aborted);
            if (request.aborted || request.destroyed || request.readableEnded) aborted();
        });
    } catch (error) {
        chunks.length = 0;
        let code: "forbidden_origin" | "invalid_input" | "payload_too_large" = "invalid_input";
        if (error instanceof Error && "code" in error
            && (error.code === "forbidden_origin" || error.code === "payload_too_large")) code = error.code;
        throw failure(code);
    }
}
