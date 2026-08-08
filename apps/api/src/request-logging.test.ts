import { HttpException } from "@nestjs/common";
import { firstValueFrom, Observable, of } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { createLogger } from "@cosmos/logging";

import {
    createRequestId,
    RequestExceptionFilter,
    RequestLoggingInterceptor,
    requestContextMiddleware,
    requestPath,
} from "./request-logging.js";

function loggerMock() {
    const logger = {
        child: vi.fn(),
        withContext: vi.fn((_context: unknown, callback: () => unknown) => callback()),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        close: vi.fn(),
    };
    logger.child.mockReturnValue(logger);
    return logger;
}

describe("request logging", () => {
    it("preserves safe request ids and creates ids for invalid input", () => {
        expect(createRequestId("request-1")).toBe("request-1");
        expect(createRequestId("not safe\nvalue")).toMatch(
            /^[0-9a-f-]{36}$/,
        );
        expect(requestPath({
            path: "/api/v1/search",
            url: "/api/v1/search?text=private",
        })).toBe("/api/v1/search");
    });

    it("logs completed requests without query strings and returns X-Request-Id", () => {
        const logger = loggerMock();
        const interceptor = new RequestLoggingInterceptor(logger as never);
        const request = {
            method: "GET",
            path: "/api/v1/health",
            url: "/api/v1/health?secret=value",
            headers: {},
        };
        const response = {
            statusCode: 200,
            headersSent: false,
            setHeader: vi.fn(),
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
        };
        const context = {
            switchToHttp: () => ({
                getRequest: () => request,
                getResponse: () => response,
            }),
        };

        requestContextMiddleware(logger as never)(
            request,
            response,
            () => undefined,
        );
        interceptor.intercept(
            context as never,
            { handle: () => of({ status: "ok" }) },
        ).subscribe();

        expect(response.setHeader).toHaveBeenCalledWith(
            "X-Request-Id",
            expect.stringMatching(/^[0-9a-f-]{36}$/),
        );
        expect(logger.debug).toHaveBeenCalledWith(
            "http.request.completed",
            expect.objectContaining({
                path: "/api/v1/health",
                status: 200,
            }),
        );
        expect(JSON.stringify(logger.debug.mock.calls)).not.toContain("secret=value");
    });

    it("adds request ids to internal error responses and logs the exception", () => {
        const logger = loggerMock();
        const filter = new RequestExceptionFilter(logger as never);
        const request = {
            method: "GET",
            path: "/api/v1/failure",
            headers: {},
            cosmosRequestId: "request-1",
            cosmosRequestStartedAt: Date.now() - 5,
        };
        const response = {
            setHeader: vi.fn(),
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
        };
        const host = {
            switchToHttp: () => ({
                getRequest: () => request,
                getResponse: () => response,
            }),
        };

        filter.catch(new Error("token=should-not-leak"), host as never);

        expect(response.setHeader).toHaveBeenCalledWith(
            "X-Request-Id",
            "request-1",
        );
        expect(response.status).toHaveBeenCalledWith(500);
        expect(response.json).toHaveBeenCalledWith({
            code: "service_unavailable",
            message: "The Cosmos service could not complete the request.",
            requestId: "request-1",
            retryable: true,
        });
        expect(logger.error).toHaveBeenCalledWith(
            "http.request.failed",
            expect.objectContaining({
                requestId: "request-1",
                path: "/api/v1/failure",
                status: 500,
            }),
            expect.any(Error),
        );
    });

    it("logs 4xx failures as warnings and normalizes the error contract", () => {
        const logger = loggerMock();
        const filter = new RequestExceptionFilter(logger as never);
        const request = {
            method: "GET",
            path: "/api/v1/missing",
            headers: {},
            cosmosRequestId: "request-2",
            cosmosRequestStartedAt: Date.now() - 5,
        };
        const response = {
            headersSent: false,
            setHeader: vi.fn(),
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
        };
        const host = {
            switchToHttp: () => ({
                getRequest: () => request,
                getResponse: () => response,
            }),
        };

        filter.catch(new HttpException({
                message: "Missing",
            }, 404), host as never);

        expect(response.json).toHaveBeenCalledWith({
            code: "not_found",
            message: "Missing",
            requestId: "request-2",
            retryable: false,
        });
        expect(logger.warn).toHaveBeenCalledWith(
            "http.request.failed",
            expect.objectContaining({
                requestId: "request-2",
                status: 404,
            }),
        );
        expect(logger.error).not.toHaveBeenCalled();
    });

    it("limits validation details and drops arbitrary error details", () => {
        const logger = loggerMock();
        const filter = new RequestExceptionFilter(logger as never);
        const request = {
            method: "POST",
            path: "/api/v1/sources",
            headers: {},
            cosmosRequestId: "request-details",
        };
        const response = {
            headersSent: false,
            setHeader: vi.fn(),
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
        };
        const host = {
            switchToHttp: () => ({
                getRequest: () => request,
                getResponse: () => response,
            }),
        };

        filter.catch(new HttpException({
            code: "validation_failed",
            message: `token=secret ${"m".repeat(10_000)}`,
            details: {
                token: "secret-token",
                formErrors: ["body=secret", "valid"],
                fieldErrors: {
                    name: ["Name is required."],
                },
            },
            retryable: false,
        }, 400), host as never);

        const body = response.json.mock.calls[0][0] as {
            message: string;
            details?: Record<string, unknown>;
        };
        expect(body.message).not.toContain("token=secret");
        expect(body.message.length).toBeLessThanOrEqual(1_024);
        expect(body.details).toEqual({
            formErrors: ["body=[REDACTED]", "valid"],
            fieldErrors: {
                name: ["Name is required."],
            },
        });

        filter.catch(new HttpException({
            code: "not_found",
            message: "Missing",
            details: {
                token: "must not be returned",
            },
            retryable: false,
        }, 404), host as never);
        expect(response.json.mock.calls[1][0]).not.toHaveProperty("details");
    });

    it("keeps request context through an asynchronous SSE subscription", async () => {
        const lines: string[] = [];
        const logger = createLogger({
            service: "request-test",
            output: "stdout",
            stdoutWriter: (line) => lines.push(line),
        });
        const interceptor = new RequestLoggingInterceptor(logger);
        const request = {
            method: "GET",
            path: "/api/v1/events",
            headers: {},
            cosmosRequestId: undefined as string | undefined,
        };
        const response = {
            statusCode: 200,
            headersSent: false,
            setHeader: vi.fn(),
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
        };
        const context = {
            switchToHttp: () => ({
                getRequest: () => request,
                getResponse: () => response,
            }),
        };
        let observable: ReturnType<typeof interceptor.intercept> | undefined;
        requestContextMiddleware(logger)(
            request,
            response,
            () => {
                observable = interceptor.intercept(
                    context as never,
                    {
                        handle: () => new Observable((subscriber) => {
                            setTimeout(() => {
                                logger.info("inside.sse.poll");
                                subscriber.next({});
                                subscriber.complete();
                            }, 0);
                        }),
                    },
                );
            },
        );

        await firstValueFrom(observable!);
        await logger.close();

        const records = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
        const requestId = request.cosmosRequestId;
        expect(records.find((record) => record.event === "inside.sse.poll")).toMatchObject({
            requestId,
        });
        expect(records.some((record) => record.event === "http.sse.closed")).toBe(true);
    });

    it("logs SSE failure before close without attempting a JSON response", async () => {
        const lines: string[] = [];
        const logger = createLogger({
            service: "request-test",
            output: "stdout",
            stdoutWriter: (line) => lines.push(line),
        });
        const interceptor = new RequestLoggingInterceptor(logger);
        const request = {
            method: "GET",
            path: "/api/v1/events",
            headers: {},
            cosmosRequestId: "sse-failure-request",
        };
        const response = {
            statusCode: 200,
            headersSent: true,
            writableEnded: false,
            setHeader: vi.fn(),
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
        };
        const context = {
            switchToHttp: () => ({
                getRequest: () => request,
                getResponse: () => response,
            }),
        };

        const observable = interceptor.intercept(
            context as never,
            {
                handle: () => new Observable((subscriber) => {
                    setTimeout(() => {
                        subscriber.error(new Error("token=should-not-leak"));
                    }, 0);
                }),
            },
        );
        await expect(firstValueFrom(observable)).rejects.toThrow(
            "token=should-not-leak",
        );
        await logger.close();

        const records = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
        const failedIndex = records.findIndex((record) => (
            record.event === "http.sse.failed"
        ));
        const closedIndex = records.findIndex((record) => (
            record.event === "http.sse.closed"
        ));
        expect(failedIndex).toBeGreaterThanOrEqual(0);
        expect(closedIndex).toBeGreaterThan(failedIndex);
        expect(records[failedIndex]).toMatchObject({
            requestId: "sse-failure-request",
            level: "error",
        });
        expect(response.json).not.toHaveBeenCalled();
        expect(lines.join("\n")).not.toContain("token=should-not-leak");
    });
});
