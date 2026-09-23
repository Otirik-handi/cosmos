/** 结构化日志端口与默认实现。 */

export interface LoggerContext {
    requestId?: string;
    runId?: string;
    jobId?: string;
    sourceId?: string;
    connectorId?: string;
    /** 连接级操作的归属（连接登录探测，Proposal connection-login-lifecycle-v1 决定 2）。 */
    connectionId?: string;
}

export interface LoggerPort {
    child(context: LoggerContext): LoggerPort;
    withContext<T>(
        context: LoggerContext,
        callback: () => T | Promise<T>,
    ): T | Promise<T>;
    debug(event: string, fields?: Record<string, unknown>): void;
    info(event: string, fields?: Record<string, unknown>): void;
    warn(event: string, fields?: Record<string, unknown>): void;
    error(
        event: string,
        fields?: Record<string, unknown>,
        error?: unknown,
    ): void;
}

export const noopLogger: LoggerPort = {
    child: () => noopLogger,
    withContext: (_context, callback) => callback(),
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
};

export function resolveLogger(logger?: LoggerPort): LoggerPort {
    return logger ?? noopLogger;
}
