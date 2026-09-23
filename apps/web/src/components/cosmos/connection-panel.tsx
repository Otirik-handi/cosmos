"use client";

import { useEffect, useState, type ComponentProps } from "react";

import type { ConnectionInstance } from "@cosmos/contracts";
import type { HttpCosmosClient } from "@cosmos/transport-http";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const statusLabel: Record<ConnectionInstance["status"], string> = {
    active: "可用",
    revoked: "已撤销",
    expired: "已过期",
    error: "错误",
};

const statusVariant = {
    active: "default",
    revoked: "outline",
    expired: "outline",
    error: "destructive",
} as const satisfies Record<ConnectionInstance["status"], NonNullable<ComponentProps<typeof Badge>["variant"]>>;

/**
 * 授权范围是 JSON 字符串（`scopeJson`）。这里只判断「是不是合法 JSON」，不约束形状：
 * 真实认证 Adapter 接上之前它的内容是用户自己的记录，形状由用户与将来的 Adapter 约定。
 */
function parseScope(raw: string): { ok: true; value: unknown } | { ok: false } {
    try {
        return { ok: true, value: JSON.parse(raw) as unknown };
    } catch {
        return { ok: false };
    }
}

/**
 * 可读渲染：顶层是「标量值对象」时按 `键: 值` 列出（授权范围的常见形状），其它形状
 * 回退到紧凑 JSON。解析不了的值原样显示——手工改库写进来的内容不该被隐藏。
 */
function formatScope(scopeJson: string): string {
    let parsed: unknown;
    try {
        parsed = JSON.parse(scopeJson) as unknown;
    } catch {
        return scopeJson;
    }
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        const entries = Object.entries(parsed as Record<string, unknown>);
        if (entries.length > 0
            && entries.every(([, value]) => value === null || typeof value !== "object")) {
            return entries.map(([key, value]) => `${key}: ${String(value)}`).join(" · ");
        }
    }
    return JSON.stringify(parsed) ?? scopeJson;
}

type ConnectionPanelProps = {
    client: HttpCosmosClient;
    /** 页面在连接变化后递增，驱动列表重取。 */
    refreshToken?: number;
};

/**
 * 连接面板（ADR-0017 / AUT-009）：列出可复用连接、新建、删除，并让用户看到与记录
 * 每个连接的**授权范围**与**失效原因**。Secret 只以 `secretRef` 不透明引用存在，
 * 本面板不展示也不读取凭证本体。
 *
 * 这两个字段今天没有自动写入方（真实认证 Adapter 属于后续切片），所以面板同时提供
 * 用户侧入口：建连接时记录授权范围，失效时自己写下原因、恢复后清除。
 */
export function ConnectionPanel({ client, refreshToken = 0 }: ConnectionPanelProps) {
    const [connections, setConnections] = useState<readonly ConnectionInstance[] | null>(null);
    const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
    const [name, setName] = useState("");
    const [connectorId, setConnectorId] = useState("");
    const [scope, setScope] = useState("");
    const [scopeError, setScopeError] = useState<string | null>(null);
    /** 正在填写失效原因的那个连接；同一时刻只开一个。 */
    const [failingId, setFailingId] = useState<string | null>(null);
    const [failureReason, setFailureReason] = useState("");

    const load = (): void => {
        client.listConnections()
            .then((list) => {
                setConnections(list);
                setState("loaded");
            })
            .catch(() => setState("error"));
    };

    useEffect(() => {
        let cancelled = false;
        client.listConnections()
            .then((list) => {
                if (!cancelled) {
                    setConnections(list);
                    setState("loaded");
                }
            })
            .catch(() => {
                if (!cancelled) setState("error");
            });
        return () => {
            cancelled = true;
        };
    }, [client, refreshToken]);

    if (state === "loading") {
        return <p className="text-sm text-muted-foreground">正在读取连接…</p>;
    }
    if (state === "error") {
        return <p className="text-sm text-muted-foreground">连接读取失败。</p>;
    }

    const create = (): void => {
        const trimmedName = name.trim();
        if (!trimmedName) return;
        const trimmedScope = scope.trim();
        let scopeJson: string | undefined;
        if (trimmedScope !== "") {
            const parsed = parseScope(trimmedScope);
            if (!parsed.ok) {
                setScopeError('授权范围必须是合法 JSON，例如 {"read": true}');
                return;
            }
            // 存规范化后的文本：用户输入的空格与换行不该成为合同的一部分。
            scopeJson = JSON.stringify(parsed.value);
        }
        setScopeError(null);
        client.createConnection({
            name: trimmedName,
            connectorId: connectorId.trim() || "generic",
            ...(scopeJson === undefined ? {} : { scopeJson }),
        })
            .then(() => {
                setName("");
                setConnectorId("");
                setScope("");
                load();
            })
            .catch(() => setState("error"));
    };

    const remove = (connectionId: string): void => {
        client.deleteConnection(connectionId)
            .then(load)
            .catch(() => setState("error"));
    };

    const markFailed = (connectionId: string): void => {
        const reason = failureReason.trim();
        if (reason === "") return;
        client.updateConnection(connectionId, { status: "error", lastError: reason })
            .then(() => {
                setFailingId(null);
                setFailureReason("");
                load();
            })
            .catch(() => setState("error"));
    };

    const restore = (connectionId: string): void => {
        client.updateConnection(connectionId, { status: "active", lastError: null })
            .then(load)
            .catch(() => setState("error"));
    };

    return (
        <div className="flex flex-col gap-2">
            {connections && connections.length > 0 ? (
                <ul className="grid gap-1">
                    {connections.map((connection) => (
                        <li
                            key={connection.id}
                            className="flex flex-col gap-1 rounded-sm border bg-card px-3 py-2 text-sm"
                        >
                            <div className="flex items-center justify-between gap-2">
                                <span className="flex min-w-0 items-center gap-2">
                                    <Badge variant={statusVariant[connection.status]}>
                                        {statusLabel[connection.status]}
                                    </Badge>
                                    <span className="truncate">{connection.name}</span>
                                    {connection.account ? (
                                        <span className="truncate text-xs text-muted-foreground">
                                            {connection.account}
                                        </span>
                                    ) : null}
                                </span>
                                <span className="flex shrink-0 items-center gap-1">
                                    {connection.status === "active" ? (
                                        <Button
                                            size="xs"
                                            variant="ghost"
                                            aria-label={`标记失效 ${connection.name}`}
                                            onClick={() => {
                                                setFailingId(connection.id);
                                                setFailureReason("");
                                            }}
                                        >
                                            标记失效
                                        </Button>
                                    ) : (
                                        <Button
                                            size="xs"
                                            variant="ghost"
                                            aria-label={`恢复可用 ${connection.name}`}
                                            onClick={() => restore(connection.id)}
                                        >
                                            恢复可用
                                        </Button>
                                    )}
                                    <Button
                                        size="xs"
                                        variant="ghost"
                                        aria-label={`删除连接 ${connection.name}`}
                                        onClick={() => remove(connection.id)}
                                    >
                                        删除
                                    </Button>
                                </span>
                            </div>
                            <dl className="grid gap-0.5 text-xs text-muted-foreground">
                                <div className="flex gap-1">
                                    <dt className="shrink-0">授权范围</dt>
                                    <dd className="min-w-0 break-words">
                                        {connection.scopeJson === null
                                            ? "未记录"
                                            : formatScope(connection.scopeJson)}
                                    </dd>
                                </div>
                                <div className="flex gap-1">
                                    <dt className="shrink-0">失效原因</dt>
                                    <dd className="min-w-0 break-words">
                                        {connection.lastError ?? "未记录"}
                                    </dd>
                                </div>
                            </dl>
                            {failingId === connection.id ? (
                                <div className="flex items-center gap-2">
                                    <Input
                                        aria-label={`失效原因 ${connection.name}`}
                                        placeholder="为什么失效（如：登录态已过期）"
                                        value={failureReason}
                                        onChange={(event) => setFailureReason(event.target.value)}
                                    />
                                    <Button
                                        size="xs"
                                        variant="outline"
                                        disabled={failureReason.trim() === ""}
                                        onClick={() => markFailed(connection.id)}
                                    >
                                        确认标记失效
                                    </Button>
                                    <Button
                                        size="xs"
                                        variant="ghost"
                                        onClick={() => {
                                            setFailingId(null);
                                            setFailureReason("");
                                        }}
                                    >
                                        取消
                                    </Button>
                                </div>
                            ) : null}
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-sm text-muted-foreground">
                    尚未创建连接；接入认证类平台前无需配置。
                </p>
            )}
            <div className="flex flex-col gap-1.5">
                <Input
                    aria-label="连接名称"
                    placeholder="连接名称"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                />
                <Input
                    aria-label="连接 Connector"
                    placeholder="Connector（如 bilibili）"
                    value={connectorId}
                    onChange={(event) => setConnectorId(event.target.value)}
                />
                <Input
                    aria-label="连接授权范围"
                    placeholder={'授权范围（JSON，可选，如 {"read": true}）'}
                    value={scope}
                    onChange={(event) => {
                        setScope(event.target.value);
                        setScopeError(null);
                    }}
                />
                {scopeError ? (
                    <p role="alert" className="text-xs text-destructive">{scopeError}</p>
                ) : null}
                <Button
                    size="sm"
                    variant="outline"
                    disabled={name.trim() === ""}
                    onClick={create}
                >
                    新建连接
                </Button>
            </div>
        </div>
    );
}
