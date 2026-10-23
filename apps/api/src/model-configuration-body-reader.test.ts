import { createServer, request } from "node:http";
import { once } from "node:events";
import { expect, it } from "vitest";
import { readModelConfigurationBody } from "./model-configuration-body-reader.js";

it("measures chunked HTTP bytes, checks raw headers and returns only fixed failures", async () => {
    let received!: () => void;
    let rejected!: (code: string) => void;
    const server = createServer(async (req, res) => {
        received?.();
        try {
            const body = await readModelConfigurationBody(req, { origins: ["http://localhost:4300"], authorities: [req.socket.localAddress + ":" + req.socket.localPort] });
            res.setHeader("Cache-Control", "no-store");
            res.end(JSON.stringify({ ok: body !== undefined }));
        } catch (error) {
            const safe = error as { code: string; status: number; message: string };
            rejected?.(safe.code);
            res.statusCode = safe.status;
            res.setHeader("Cache-Control", "no-store");
            res.end(JSON.stringify({ code: safe.code, message: safe.message }));
        }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing local address.");
    const authority = `127.0.0.1:${address.port}`;
    const send = (chunks: Buffer[], extra: string[] = []) => new Promise<{ status: number; text: string }>((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port: address.port, method: "POST", headers: ["Host", authority, "Origin", "http://localhost:4300", "Content-Type", "application/json", ...extra] }, (res) => {
            let text = "";
            res.on("data", (chunk) => { text += String(chunk); });
            res.on("end", () => resolve({ status: res.statusCode!, text }));
        });
        req.on("error", reject);
        for (const chunk of chunks) req.write(chunk);
        req.end();
    });
    try {
        expect((await send([Buffer.from('{"value":'), Buffer.from('"ok"}')])).status).toBe(200);
        const exact = Buffer.from('"' + "a".repeat(32766) + '"');
        expect((await send([exact])).status).toBe(200);
        expect(await send([exact, Buffer.from(" ")])).toMatchObject({ status: 413 });
        expect(await send([Buffer.from("PRIVATE_SENTINEL")])).toMatchObject({ status: 400 });
        expect(await send([Buffer.from([0x22, 0xff, 0x22])])).toMatchObject({ status: 400 });
        expect(await send([Buffer.from("{}")], ["Origin", "http://localhost:4300"])).toMatchObject({ status: 403 });
        expect(await send([Buffer.from("{}")], ["Content-Type", "application/json"])).toMatchObject({ status: 400 });
        const compressed = await send([Buffer.from("PRIVATE_SENTINEL")], ["Content-Encoding", "gzip"]);
        expect(compressed.status).toBe(400);
        expect(compressed.text).not.toContain("PRIVATE_SENTINEL");
        // Do not end the request: rejection must happen before a terminating chunk arrives.
        await new Promise<void>((resolve, reject) => {
            const req = request({ host: "127.0.0.1", port: address.port, method: "POST", headers: {
                Host: authority, Origin: "http://localhost:4300", "Content-Type": "application/json",
            } }, (res) => {
                res.resume();
                res.once("end", () => {
                    req.destroy();
                    try { expect(res.statusCode).toBe(413); resolve(); } catch (error) { reject(error); }
                });
            });
            req.setTimeout(2000, () => { req.destroy(); reject(new Error("Oversized request was not rejected before end.")); });
            req.on("error", reject);
            req.write(Buffer.alloc(32769, 0x20));
        });
        const started = new Promise<void>((resolve) => { received = resolve; });
        const stopped = new Promise<string>((resolve) => { rejected = resolve; });
        const interrupted = request({ host: "127.0.0.1", port: address.port, method: "POST", headers: {
            Host: authority, Origin: "http://localhost:4300", "Content-Type": "application/json",
        } });
        interrupted.on("error", () => {});
        interrupted.write('{"incomplete":');
        await started;
        interrupted.destroy();
        expect(await stopped).toBe("invalid_input");
    } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
});
