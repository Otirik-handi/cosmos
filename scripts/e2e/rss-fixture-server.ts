import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

const host = process.env.COSMOS_E2E_RSS_HOST?.trim() || "127.0.0.1";
const port = readPort(process.env.COSMOS_E2E_RSS_PORT?.trim() || "4380");
const basicXml = await readFile(new URL("../../fixtures/rss/basic.xml", import.meta.url), "utf8");
const offlineXml = await readFile(new URL("../../fixtures/rss/offline-media.xml", import.meta.url), "utf8");
const fixtureImage = await readFile(new URL("../../fixtures/rss/media/fixture-image.svg", import.meta.url), "utf8");
const routes: Record<string, { body: string; contentType: string }> = {
    "/feed.xml": {
        body: basicXml,
        contentType: "application/rss+xml; charset=utf-8",
    },
    "/offline.xml": {
        body: offlineXml,
        contentType: "application/rss+xml; charset=utf-8",
    },
    "/media/fixture-image.svg": {
        body: fixtureImage,
        contentType: "image/svg+xml; charset=utf-8",
    },
};
const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://fixture.invalid").pathname;
    const route = request.method === "GET" ? routes[path] : undefined;
    if (!route) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
    }
    response.writeHead(200, {
        "content-type": route.contentType,
        "content-length": Buffer.byteLength(route.body),
    });
    response.end(route.body);
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
