import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";

export interface ControlledRssRequest {
    sequence: number;
    method: string;
    url: string;
    receivedAt: string;
}

export interface ControlledRssServer {
    readonly server: Server;
    readonly url: string;
    readonly port: number;
    readonly requests: readonly ControlledRssRequest[];
    waitForRequest(count?: number, timeoutMs?: number): Promise<ControlledRssRequest>;
    release(xml?: string): void;
    respond(status: number, body?: string, headers?: Record<string, string>): void;
    close(): Promise<void>;
}

interface PendingResponse {
    response: ServerResponse;
    request: IncomingMessage;
}

export async function createControlledRssServer(
    initialXml: string,
): Promise<ControlledRssServer> {
    let xml = initialXml;
    let responseStatus = 200;
    let responseHeaders: Record<string, string> = {
        "content-type": "application/rss+xml; charset=utf-8",
    };
    let released = false;
    let sequence = 0;
    const requests: ControlledRssRequest[] = [];
    const pending: PendingResponse[] = [];
    const waiters = new Set<{
        count: number;
        resolve: (request: ControlledRssRequest) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
    }>();
    const sockets = new Set<import("node:net").Socket>();

    const server = createServer((request, response) => {
        const observed: ControlledRssRequest = {
            sequence: sequence += 1,
            method: request.method ?? "GET",
            url: request.url ?? "/",
            receivedAt: new Date().toISOString(),
        };
        requests.push(observed);
        for (const waiter of [...waiters]) {
            if (requests.length < waiter.count) continue;
            clearTimeout(waiter.timer);
            waiters.delete(waiter);
            waiter.resolve(observed);
        }
        if (released) {
            writeResponse(response, responseStatus, responseHeaders, xml);
            return;
        }
        pending.push({ request, response });
        request.once("aborted", () => removePending(response));
        response.once("close", () => removePending(response));
    });
    server.on("connection", (socket) => {
        sockets.add(socket);
        socket.once("close", () => sockets.delete(socket));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") {
        throw new Error("Controlled RSS server did not expose a TCP port.");
    }

    return {
        server,
        url: `http://127.0.0.1:${address.port}/feed.xml`,
        port: address.port,
        get requests() {
            return [...requests];
        },
        waitForRequest(count = 1, timeoutMs = 10_000) {
            const existing = requests[count - 1];
            if (existing) return Promise.resolve(existing);
            return new Promise((resolveRequest, rejectRequest) => {
                const timer = setTimeout(() => {
                    waiters.delete(waiter);
                    rejectRequest(new Error(`Timed out waiting for RSS request ${count}.`));
                }, timeoutMs);
                const waiter = {
                    count,
                    resolve: resolveRequest,
                    reject: rejectRequest,
                    timer,
                };
                waiters.add(waiter);
            });
        },
        release(nextXml = xml) {
            xml = nextXml;
            released = true;
            for (const item of pending.splice(0)) {
                writeResponse(item.response, responseStatus, responseHeaders, xml);
            }
        },
        respond(status, body = xml, headers = responseHeaders) {
            responseStatus = status;
            responseHeaders = { ...headers };
            if (released) {
                for (const item of pending.splice(0)) {
                    writeResponse(item.response, responseStatus, responseHeaders, body);
                }
            }
        },
        close() {
            for (const item of pending.splice(0)) item.response.destroy();
            for (const socket of sockets) socket.destroy();
            for (const waiter of waiters) {
                clearTimeout(waiter.timer);
                waiter.reject(new Error("Controlled RSS server closed."));
            }
            waiters.clear();
            return new Promise<void>((resolveClose, rejectClose) => {
                server.close((error) => error ? rejectClose(error) : resolveClose());
            });
        },
    };

    function removePending(response: ServerResponse): void {
        const index = pending.findIndex((item) => item.response === response);
        if (index >= 0) pending.splice(index, 1);
    }
}

function writeResponse(
    response: ServerResponse,
    status: number,
    headers: Record<string, string>,
    body: string,
): void {
    if (response.writableEnded || response.destroyed) return;
    response.writeHead(status, headers);
    response.end(body);
}
