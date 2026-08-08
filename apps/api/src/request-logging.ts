import {
    Catch,
    HttpException,
    type ArgumentsHost,
    type ExceptionFilter,
    type CallHandler,
    type ExecutionContext,
    Injectable,
    type NestInterceptor,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
    catchError,
    finalize,
    throwError,
    Observable,
    type Subscription,
} from "rxjs";

import {
    serviceErrorCodeSchema,
    type ServiceError,
} from "@cosmos/contracts";
import {
    sanitizeLogText,
    type Logger,
} from "@cosmos/logging";

interface HttpRequestLike {
    method?: string;
    url?: string;
    originalUrl?: string;
    path?: string;
    route?: {
        path?: string;
    };
    headers?: Record<string, string | string[] | undefined>;
    cosmosRequestId?: string;
    cosmosRequestStartedAt?: number;
}

interface HttpResponseLike {
    statusCode?: number;
    headersSent?: boolean;
    writableEnded?: boolean;
    setHeader(name: string, value: string): void;
    getHeader?(name: string): unknown;
    status(code: number): this;
    json(body: unknown): void;
}

const maxServiceErrorMessageLength = 1_024;
const maxValidationFields = 16;
const maxValidationMessages = 3;
const maxValidationMessageLength = 256;
const maxValidationDetailsBytes = 16 * 1024;

export function requestContextMiddleware(
    logger: Logger,
): (
    request: HttpRequestLike,
    response: HttpResponseLike,
    next: () => void,
) => void {
    return (request, response, next): void => {
        const requestId = createRequestId(request.headers?.["x-request-id"]);
        request.cosmosRequestId = requestId;
        request.cosmosRequestStartedAt = Date.now();
        if (!response.headersSent) {
            response.setHeader("X-Request-Id", requestId);
        }
        logger.withContext({ requestId }, () => next());
    };
}

export function createRequestId(value: unknown): string {
    if (typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
        return value;
    }
    if (Array.isArray(value) && typeof value[0] === "string") {
        return createRequestId(value[0]);
    }
    return randomUUID();
}

export function requestPath(request: HttpRequestLike): string {
    const route = request.route?.path;
    if (typeof route === "string" && route) {
        return route;
    }
    return (request.path ?? request.originalUrl ?? request.url ?? "/")
        .split("?")[0] || "/";
}

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
    constructor(private readonly logger: Logger) {}

    intercept(
        context: ExecutionContext,
        next: CallHandler,
    ): Observable<unknown> {
        const request = context.switchToHttp().getRequest<HttpRequestLike>();
        const response = context.switchToHttp().getResponse<HttpResponseLike>();
        const requestId = request.cosmosRequestId
            ?? createRequestId(request.headers?.["x-request-id"]);
        const startedAt = request.cosmosRequestStartedAt ?? Date.now();
        request.cosmosRequestId = requestId;
        request.cosmosRequestStartedAt = startedAt;
        const requestLogger = this.logger.child({ requestId });
        const path = requestPath(request);
        const isSse = path.endsWith("/events");
        if (isSse) {
            requestLogger.info("http.sse.connected", {
                method: request.method ?? "GET",
                path,
            });
        }

        return new Observable<unknown>((subscriber) => {
            let subscription: Subscription | undefined;
            requestLogger.withContext({ requestId }, () => {
                let failed = false;
                subscription = next.handle().pipe(
                    catchError((error: unknown) => {
                        failed = true;
                        if (isSse) {
                            requestLogger.error("http.sse.failed", {
                                method: request.method ?? "UNKNOWN",
                                path: requestPath(request),
                                status: response.statusCode ?? 500,
                                durationMs: Date.now() - startedAt,
                            }, error);
                        }
                        return throwError(() => error);
                    }),
                    finalize(() => {
                        const status = response.statusCode ?? (failed ? 500 : 200);
                        const completedPath = requestPath(request);
                        const fields = {
                            method: request.method ?? "UNKNOWN",
                            path: completedPath,
                            status,
                            durationMs: Date.now() - startedAt,
                            ...(failed ? { failed: true } : {}),
                        };
                        if (isSse) {
                            requestLogger.info("http.sse.closed", fields);
                        } else if (failed) {
                            return;
                        } else if (completedPath.endsWith("/health") && status < 400) {
                            requestLogger.debug("http.request.completed", fields);
                        } else if (status >= 400) {
                            requestLogger.warn("http.request.completed", fields);
                        } else {
                            requestLogger.info("http.request.completed", fields);
                        }
                    }),
                ).subscribe(subscriber);
            });
            return () => subscription?.unsubscribe();
        });
    }
}

@Catch()
export class RequestExceptionFilter implements ExceptionFilter {
    constructor(private readonly logger: Logger) {}

    catch(exception: unknown, host: ArgumentsHost): void {
        const context = host.switchToHttp();
        const request = context.getRequest<HttpRequestLike>();
        const response = context.getResponse<HttpResponseLike>();
        const requestId = request.cosmosRequestId
            ?? createRequestId(request.headers?.["x-request-id"]);
        const status = exception instanceof HttpException
            ? exception.getStatus()
            : 500;
        const responseBody = exception instanceof HttpException
            ? exception.getResponse()
            : null;
        const body = normalizeErrorResponse(responseBody, status, requestId);
        const headersAlreadySent = response.headersSent === true
            || response.writableEnded === true;

        if (!headersAlreadySent) {
            response.setHeader("X-Request-Id", requestId);
            response.status(status).json(body);
        }
        const requestLogger = this.logger.child({ requestId });
        const fields = {
            requestId,
            method: request.method ?? "UNKNOWN",
            path: requestPath(request),
            status,
            durationMs: request.cosmosRequestStartedAt
                ? Date.now() - request.cosmosRequestStartedAt
                : undefined,
            ...(headersAlreadySent ? { headersSent: true } : {}),
        };
        if (status >= 500) {
            requestLogger.error("http.request.failed", fields, exception);
        } else {
            requestLogger.warn("http.request.failed", fields);
        }
    }
}

function normalizeErrorResponse(
    value: unknown,
    status: number,
    requestId: string,
): ServiceError {
    const candidate = isRecord(value) ? value : {};
    const candidateCode = serviceErrorCodeSchema.safeParse(candidate.code);
    const rawMessage = typeof candidate.message === "string"
        ? candidate.message
        : typeof value === "string"
            ? value
            : status >= 500
                ? "The Cosmos service could not complete the request."
                : "Request failed.";
    const message = sanitizeLogText(rawMessage)
        .slice(0, maxServiceErrorMessageLength);
    const details = candidateCode.success
        && candidateCode.data === "validation_failed"
        ? normalizeValidationDetails(candidate.details)
        : undefined;
    return {
        code: candidateCode.success
            ? candidateCode.data
            : fallbackErrorCode(status),
        message,
        requestId,
        ...(details ? { details } : {}),
        retryable: typeof candidate.retryable === "boolean"
            ? candidate.retryable
            : status >= 500,
    };
}

function normalizeValidationDetails(
    value: unknown,
): ServiceError["details"] | undefined {
    if (!isRecord(value)) {
        return undefined;
    }

    const formErrors = normalizeValidationMessages(
        value.formErrors,
        maxValidationMessages,
    );
    const fieldErrors: Record<string, readonly string[]> = {};
    if (isRecord(value.fieldErrors)) {
        for (const [field, messages] of Object.entries(value.fieldErrors)
            .slice(0, maxValidationFields)) {
            const normalized = normalizeValidationMessages(
                messages,
                maxValidationMessages,
            );
            if (normalized.length > 0) {
                fieldErrors[sanitizeLogText(field).slice(0, 128)] = normalized;
            }
        }
    }

    const details = {
        ...(formErrors.length > 0 ? { formErrors } : {}),
        ...(Object.keys(fieldErrors).length > 0 ? { fieldErrors } : {}),
    };
    if (Object.keys(details).length === 0) {
        return undefined;
    }
    return Buffer.byteLength(JSON.stringify(details), "utf8")
        <= maxValidationDetailsBytes
        ? details
        : undefined;
}

function normalizeValidationMessages(
    value: unknown,
    maxItems: number,
): readonly string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((item): item is string => typeof item === "string")
        .slice(0, maxItems)
        .map((item) => sanitizeLogText(item).slice(0, maxValidationMessageLength))
        .filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object"
        && value !== null
        && !Array.isArray(value);
}

function fallbackErrorCode(
    status: number,
): ServiceError["code"] {
    if (status >= 500) {
        return "service_unavailable";
    }
    if (status === 404) {
        return "not_found";
    }
    if (status === 409) {
        return "conflict";
    }
    if (status >= 400) {
        return "validation_failed";
    }
    return "uncertain";
}
