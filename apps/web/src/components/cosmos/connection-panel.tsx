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

type ConnectionPanelProps = {
    client: HttpCosmosClient;
    /** 页面在连接变化后递增，驱动列表重取。 */
    refreshToken?: number;
};

/**
 * 连接面板（ADR-0017）：列出可复用连接、新建、删除。Secret 只以 `secretRef`
 * 不透明引用存在，本面板不展示也不读取凭证本体。
 */
export function ConnectionPanel({ client, refreshToken = 0 }: ConnectionPanelProps) {
    const [connections, setConnections] = useState<readonly ConnectionInstance[] | null>(null);
    const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
    const [name, setName] = useState("");
    const [connectorId, setConnectorId] = useState("");

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
        client.createConnection({
            name: trimmedName,
            connectorId: connectorId.trim() || "generic",
        })
            .then(() => {
                setName("");
                setConnectorId("");
                load();
            })
            .catch(() => setState("error"));
    };

    const remove = (connectionId: string): void => {
        client.deleteConnection(connectionId)
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
                            className="flex items-center justify-between gap-2 rounded-sm border bg-card px-3 py-2 text-sm"
                        >
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
                            <Button
                                size="xs"
                                variant="ghost"
                                aria-label={`删除连接 ${connection.name}`}
                                onClick={() => remove(connection.id)}
                            >
                                删除
                            </Button>
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
