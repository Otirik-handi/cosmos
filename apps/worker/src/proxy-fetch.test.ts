import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
    createProxyFetch,
    describeProxyConfig,
} from "./proxy-fetch.js";

const feedXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Proxy fixture</title><item><title>via proxy</title></item></channel></rss>`;

let proxyServer: Server;
let proxyPort: number;
const proxyRequests: string[] = [];

let originServer: Server;
let originPort: number;
let originRequests = 0;

beforeAll(async () => {
    proxyServer = createServer((request, response) => {
        // Proxied requests arrive in absolute-form (full URL) while direct
        // requests use origin-form; normalize both to a path for assertions.
        proxyRequests.push(new URL(request.url ?? "/", "http://localhost").pathname);
        response.writeHead(200, { "content-type": "application/xml" });
        response.end(feedXml);
    });
    await new Promise<void>((resolve) => proxyServer.listen(0, "127.0.0.1", resolve));
    proxyPort = (proxyServer.address() as AddressInfo).port;

    originServer = createServer((_request, response) => {
        originRequests += 1;
        response.writeHead(200, { "content-type": "application/xml" });
        response.end(feedXml);
    });
    await new Promise<void>((resolve) => originServer.listen(0, "127.0.0.1", resolve));
    originPort = (originServer.address() as AddressInfo).port;
});

afterAll(async () => {
    await Promise.all([
        new Promise<void>((resolve) => proxyServer.close(() => resolve())),
        new Promise<void>((resolve) => originServer.close(() => resolve())),
    ]);
});

describe("worker proxy fetch", () => {
    it("routes HTTP fetches through the configured proxy", async () => {
        proxyRequests.length = 0;
        const fetchWithProxy = createProxyFetch({
            env: {
                HTTP_PROXY: `http://127.0.0.1:${proxyPort}`,
                HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`,
            },
        });

        const response = await fetchWithProxy("http://proxy.example.test/feed.xml");

        expect(response.status).toBe(200);
        expect(await response.text()).toContain("via proxy");
        expect(proxyRequests).toEqual(["/feed.xml"]);
    });

    it("bypasses the proxy for loopback targets even without NO_PROXY", async () => {
        proxyRequests.length = 0;
        originRequests = 0;
        const fetchWithProxy = createProxyFetch({
            env: {
                HTTP_PROXY: `http://127.0.0.1:${proxyPort}`,
                HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`,
            },
        });

        const response = await fetchWithProxy(`http://127.0.0.1:${originPort}/feed.xml`);

        expect(response.status).toBe(200);
        expect(originRequests).toBe(1);
        expect(proxyRequests).toHaveLength(0);
    });

    it("honors NO_PROXY for non-loopback hosts", async () => {
        proxyRequests.length = 0;
        originRequests = 0;
        const fetchWithProxy = createProxyFetch({
            env: {
                HTTP_PROXY: `http://127.0.0.1:${proxyPort}`,
                HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`,
                NO_PROXY: "127.0.0.1",
            },
        });

        const response = await fetchWithProxy(`http://127.0.0.1:${originPort}/feed.xml`);

        expect(response.status).toBe(200);
        expect(originRequests).toBe(1);
        expect(proxyRequests).toHaveLength(0);
    });

    it("rejects non-http(s) proxy schemes at construction", () => {
        expect(() => createProxyFetch({
            env: { HTTP_PROXY: "ftp://proxy.example.test" },
        })).toThrow(/Unsupported proxy scheme/);
    });

    it("never exposes proxy credentials in the sanitized summary", () => {
        const summary = describeProxyConfig({
            HTTP_PROXY: "http://user:secret@127.0.0.1:8080",
        });
        expect(summary).toEqual({
            enabled: true,
            proxyHost: "127.0.0.1:8080",
        });
    });

    it("returns the plain fetch when no proxy is configured", async () => {
        proxyRequests.length = 0;
        originRequests = 0;
        const fetchWithProxy = createProxyFetch({ env: {} });

        const response = await fetchWithProxy(`http://127.0.0.1:${originPort}/feed.xml`);

        expect(response.status).toBe(200);
        expect(originRequests).toBe(1);
        expect(proxyRequests).toHaveLength(0);
    });
});
