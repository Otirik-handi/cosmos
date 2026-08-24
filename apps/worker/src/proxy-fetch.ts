import { ProxyAgent, fetch as undiciFetch } from "undici";

export interface ProxyFetchOptions {
    env?: NodeJS.ProcessEnv;
}

export interface ProxyConfigSummary {
    enabled: boolean;
    proxyHost: string | null;
}

const loopbackHosts = new Set([
    "127.0.0.1",
    "localhost",
    "::1",
    "[::1]",
    "0.0.0.0",
    "::",
]);

/**
 * Wraps the connector fetch so RSS/AIHOT network calls honor the standard
 * HTTP(S)_PROXY / NO_PROXY environment contract. Neither Bun's nor Node's
 * global fetch reads these variables on its own; undici's fetch accepts an
 * explicit ProxyAgent dispatcher and works under both runtimes, so a
 * configured proxy always routes through it while bypass paths keep the
 * native fetch.
 *
 * Loopback addresses always bypass the proxy: a configured proxy must never
 * capture the controlled local RSS servers used by acceptance and E2E runs.
 */
export function createProxyFetch(options: ProxyFetchOptions = {}): typeof globalThis.fetch {
    const env = options.env ?? process.env;
    const proxies = resolveProxyUrls(env);
    if (!proxies.http && !proxies.https) return globalThis.fetch;
    const noProxy = parseNoProxy(env.NO_PROXY ?? env.no_proxy);
    const agent = new ProxyAgent(proxies.https ?? proxies.http ?? "");

    const wrapped: typeof globalThis.fetch = (input, init) => {
        const target = toUrlString(input);
        if (bypassesProxy(target, noProxy)) {
            return globalThis.fetch(input, init);
        }
        // undici ships its own Response types; the connectors only consume
        // status/text/ok, so the cast to the DOM shape is safe at this edge.
        return undiciFetch(
            input as string | URL,
            { ...init, dispatcher: agent } as Parameters<typeof undiciFetch>[1],
        ) as unknown as Promise<Response>;
    };
    return wrapped;
}

/**
 * Sanitized proxy summary for structured logs: host and port only, never the
 * user:pass credentials that may be embedded in the configured URL.
 */
export function describeProxyConfig(env: NodeJS.ProcessEnv = process.env): ProxyConfigSummary {
    const proxies = resolveProxyUrls(env);
    const proxyUrl = proxies.https ?? proxies.http;
    if (!proxyUrl) return { enabled: false, proxyHost: null };
    return { enabled: true, proxyHost: proxyHostLabel(proxyUrl) };
}

function resolveProxyUrls(env: NodeJS.ProcessEnv): { http: string | null; https: string | null } {
    return {
        http: validateProxyUrl(env.HTTP_PROXY ?? env.http_proxy),
        https: validateProxyUrl(env.HTTPS_PROXY ?? env.https_proxy),
    };
}

function validateProxyUrl(value: string | undefined): string | null {
    if (!value) return null;
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        throw new Error(`Invalid proxy URL: ${proxyHostLabel(value)}.`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(`Unsupported proxy scheme: ${parsed.protocol}.`);
    }
    return value;
}

function selectProxy(target: string, proxies: { http: string | null; https: string | null }): string {
    const isHttps = toUrlString(target).startsWith("https:");
    return isHttps ? (proxies.https ?? proxies.http ?? "") : (proxies.http ?? proxies.https ?? "");
}

function parseNoProxy(value: string | undefined): string[] {
    if (!value) return [];
    return value
        .split(/[\s,]+/)
        .map((entry) => entry.trim().toLowerCase().replace(/:\d+$/, ""))
        .filter(Boolean);
}

function bypassesProxy(target: string, noProxy: string[]): boolean {
    let hostname: string;
    try {
        hostname = new URL(target).hostname.toLowerCase();
    } catch {
        return true;
    }
    if (loopbackHosts.has(hostname)) return true;
    if (noProxy.includes("*")) return true;
    return noProxy.some((entry) => {
        if (entry.startsWith(".")) {
            return hostname === entry.slice(1) || hostname.endsWith(entry);
        }
        return hostname === entry || hostname.endsWith(`.${entry}`);
    });
}

function toUrlString(input: RequestInfo | URL): string {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    return input.url;
}

function proxyHostLabel(proxyUrl: string): string {
    try {
        const parsed = new URL(proxyUrl);
        return `${parsed.hostname}:${parsed.port || (parsed.protocol === "https:" ? "443" : "80")}`;
    } catch {
        return "<unparseable>";
    }
}
