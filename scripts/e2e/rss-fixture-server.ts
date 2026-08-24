import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

const host = process.env.COSMOS_E2E_RSS_HOST?.trim() || "127.0.0.1";
const port = readPort(process.env.COSMOS_E2E_RSS_PORT?.trim() || "4380");
const xml = await readFile(new URL("../../fixtures/rss/basic.xml", import.meta.url), "utf8");
const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://fixture.invalid").pathname;
    if (request.method !== "GET" || path !== "/feed.xml") {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
    }
    response.writeHead(200, {
        "content-type": "application/rss+xml; charset=utf-8",
        "content-length": Buffer.byteLength(xml),
    });
    response.end(xml);
});

await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
});
process.stdout.write(`RSS_FIXTURE_READY http://${host}:${port}/feed.xml\n`);

let stopping = false;
const stop = (): void => {
    if (stopping) return;
    stopping = true;
    server.close((error) => {
        process.exitCode = error ? 1 : 0;
    });
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

function readPort(raw: string): number {
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
        throw new Error(`Invalid RSS fixture port: ${raw}`);
    }
    return value;
}
