import { IncomingMessage, Server as HttpServer, ServerResponse, createServer } from "node:http";
import { EventEmitter, once } from "node:events";
import { setTimeout as delayTimer } from "node:timers/promises";
import { cloneDrain, isTerminalDrain, parseDrainCommand } from "./drain.js";
import { defaultComponents, failureSnapshot, publicFailureMessage, sanitizeComponents } from "./health.js";
import { WorkerAdminService } from "./service.js";
import { WorkerAdminRequestError } from "./types.js";
import type { ComponentHealth, WorkerAdminOptions, WorkerDrainSnapshot, WorkerStatusSnapshot } from "./types.js";

export interface WorkerAdminServerOptions extends WorkerAdminOptions {
    host?: string;
    port?: number;
    authorize?: (request: IncomingMessage) => boolean | Promise<boolean>;
    maxBodyBytes?: number;
}

export interface WorkerAdminServer {
    readonly service: WorkerAdminService;
    readonly server: HttpServer;
    start(): Promise<void>;
    close(): Promise<void>;
}

export function createWorkerAdminServer(options: WorkerAdminServerOptions): WorkerAdminServer {
    const host = options.host ?? "127.0.0.1";
    if (!isLoopbackOrInternalHost(host) && !options.authorize) {
        throw new Error("Worker Admin requires authorize middleware when bound beyond loopback.");
    }
    const service = new WorkerAdminService(options);
    const server = createServer((request, response) => {
        void handleRequest(request, response, service, options).catch((error: unknown) => {
            writeError(response, error);
        });
    });
    let listening = false;
    return {
        service,
        server,
        start: async () => {
            if (listening) return;
            server.listen(options.port ?? 9_091, host);
            await once(server, "listening");
            listening = true;
        },
        close: async () => {
            if (!listening) return;
            server.close();
            await once(server, "close");
            listening = false;
        },
    };
}

export async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
    service: WorkerAdminService,
    options: WorkerAdminServerOptions,
): Promise<void> {
    if (options.authorize && !(await options.authorize(request))) {
        throw new WorkerAdminRequestError("unauthorized", "Worker Admin authorization failed.", 401);
    }
    const url = new URL(request.url ?? "/", "http://worker-admin.local");
    const path = url.pathname;
    if (request.method === "GET" && path === "/healthz") {
        writeJson(response, 200, service.liveness());
        return;
    }
    if (request.method === "GET" && path === "/readyz") {
        const snapshot = await service.readiness();
        writeJson(response, snapshot.ready ? 200 : 503, snapshot);
        return;
    }
    if (request.method === "GET" && path === "/metrics") {
        writeText(response, 200, service.metrics());
        return;
    }
    if (request.method === "GET" && path === "/admin/v1/status") {
        writeJson(response, 200, service.status());
        return;
    }
    if (request.method === "GET" && path === "/admin/v1/capabilities") {
        writeJson(response, 200, service.capabilities());
        return;
    }
    if (request.method === "GET" && path === "/admin/v1/drains") {
        writeJson(response, 200, {
            items: service.listDrains(),
            nextCursor: null,
            snapshotAt: new Date().toISOString(),
        });
        return;
    }
    if (request.method === "POST" && path === "/admin/v1/drains") {
        const idempotencyKey = headerValue(request, "idempotency-key");
        if (!idempotencyKey) {
            throw new WorkerAdminRequestError(
                "invalid_request",
                "Idempotency-Key is required for Worker drain commands.",
                400,
            );
        }
        const body = await readJsonBody(request, options.maxBodyBytes ?? 64 * 1024);
        const decision = service.requestDrain(idempotencyKey, parseDrainCommand(body));
        writeJson(response, decision.statusCode, decision.snapshot);
        return;
    }
    const drainMatch = path.match(/^\/admin\/v1\/drains\/([^/]+)$/);
    if (request.method === "GET" && drainMatch) {
        const snapshot = service.getDrain(decodeURIComponent(drainMatch[1]));
        if (!snapshot) {
            throw new WorkerAdminRequestError("not_found", "Worker drain not found.", 404);
        }
        writeJson(response, 200, snapshot);
        return;
    }
    throw new WorkerAdminRequestError("not_found", "Worker Admin endpoint not found.", 404);
}

export function isLoopbackOrInternalHost(host: string): boolean {
    return host === "127.0.0.1"
        || host === "::1"
        || host === "localhost";
}

export function headerValue(request: IncomingMessage, name: string): string | null {
    const value = request.headers[name.toLowerCase()];
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
}

export async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > maxBytes) {
            throw new WorkerAdminRequestError(
                "payload_too_large",
                "Worker Admin request body is too large.",
                413,
            );
        }
        chunks.push(buffer);
    }
    if (chunks.length === 0) return {};
    let parsed: unknown;
    try {
        parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
        throw new WorkerAdminRequestError("invalid_request", "Request body must be valid JSON.", 400);
    }
    if (!isRecord(parsed)) {
        throw new WorkerAdminRequestError("invalid_request", "Request body must be a JSON object.", 400);
    }
    return parsed;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
    const body = JSON.stringify(value);
    response.statusCode = statusCode;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("content-length", Buffer.byteLength(body));
    response.end(body);
}

export function writeText(response: ServerResponse, statusCode: number, body: string): void {
    response.statusCode = statusCode;
    response.setHeader("content-type", "text/plain; version=0.0.4; charset=utf-8");
    response.setHeader("content-length", Buffer.byteLength(body));
    response.end(body);
}

export function writeError(response: ServerResponse, error: unknown): void {
    if (response.headersSent) {
        response.destroy();
        return;
    }
    if (error instanceof WorkerAdminRequestError) {
        writeJson(response, error.statusCode, {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
        });
        return;
    }
    writeJson(response, 500, {
        code: "internal_error",
        message: "Worker Admin request failed.",
        retryable: true,
    });
}
