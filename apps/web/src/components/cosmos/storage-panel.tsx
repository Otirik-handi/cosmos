"use client";

import { useEffect, useState } from "react";

import type { BackupSnapshot, StorageStats } from "@cosmos/contracts";
import type { HttpCosmosClient } from "@cosmos/transport-http";

import { Button } from "@/components/ui/button";

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB"] as const;
    let value = bytes;
    let unit = "B";
    for (const next of units) {
        if (value < 1024) break;
        value /= 1024;
        unit = next;
    }
    return `${value.toFixed(value >= 10 || unit === "B" ? 0 : 1)} ${unit}`;
}

type StoragePanelProps = {
    client: HttpCosmosClient;
};

/**
 * 存储面板（ADR-0019 / OPS-003/004）：展示数据库/Blob/缓存等占用，提供备份
 * 列表、新建备份与恢复。恢复会覆盖当前数据库，故先做一次「恢复前保护备份」。
 */
export function StoragePanel({ client }: StoragePanelProps) {
    const [stats, setStats] = useState<StorageStats | null>(null);
    const [backups, setBackups] = useState<readonly BackupSnapshot[] | null>(null);
    const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    const load = (): void => {
        Promise.all([client.storageStats(), client.listBackups()])
            .then(([statsResult, backupResult]) => {
                setStats(statsResult);
                setBackups(backupResult);
                setState("loaded");
            })
            .catch(() => setState("error"));
    };

    useEffect(() => {
        let cancelled = false;
        Promise.all([client.storageStats(), client.listBackups()])
            .then(([statsResult, backupResult]) => {
                if (!cancelled) {
                    setStats(statsResult);
                    setBackups(backupResult);
                    setState("loaded");
                }
            })
            .catch(() => {
                if (!cancelled) setState("error");
            });
        return () => {
            cancelled = true;
        };
    }, [client]);

    if (state === "loading") return <p className="text-sm text-muted-foreground">正在读取存储占用…</p>;
    if (state === "error") return <p className="text-sm text-muted-foreground">存储信息读取失败。</p>;
    if (!stats || !backups) return null;

    const createBackup = (): void => {
        setBusy(true);
        setMessage(null);
        client.createBackup()
            .then(() => {
                setMessage("已创建数据库备份。");
                load();
            })
            .catch(() => setMessage("备份失败。"))
            .finally(() => setBusy(false));
    };

    const restore = (backupId: string): void => {
        setBusy(true);
        setMessage(null);
        client.restoreBackup(backupId)
            .then(() => setMessage(`已从 ${backupId} 恢复；请重启 API/Worker 使其生效。`))
            .catch(() => setMessage("恢复失败。"))
            .finally(() => setBusy(false));
    };

    return (
        <div className="flex flex-col gap-2">
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <li>数据库 <span className="float-right font-medium">{formatBytes(stats.databaseBytes)}</span></li>
                <li>Blob <span className="float-right font-medium">{formatBytes(stats.blobBytes)}</span></li>
                <li>缓存 <span className="float-right font-medium">{formatBytes(stats.cacheBytes)}</span></li>
                <li>可清理媒体 <span className="float-right font-medium">{formatBytes(stats.categories.cleanable)}</span></li>
            </ul>
            <div className="flex items-center gap-2">
                <Button size="xs" variant="outline" disabled={busy} onClick={createBackup}>新建备份</Button>
                <span className="text-xs text-muted-foreground">{backups.length} 个备份</span>
            </div>
            {backups.length > 0 && (
                <ul className="grid gap-1">
                    {backups.map((backup) => (
                        <li
                            key={backup.id}
                            className="flex items-center justify-between gap-2 rounded-sm border bg-card px-3 py-1.5 text-xs"
                        >
                            <span className="min-w-0 truncate">{backup.name}</span>
                            <span className="flex shrink-0 items-center gap-2">
                                <span className="text-muted-foreground">{formatBytes(backup.byteSize)}</span>
                                <Button size="xs" variant="ghost" disabled={busy} onClick={() => restore(backup.id)}>
                                    恢复
                                </Button>
                            </span>
                        </li>
                    ))}
                </ul>
            )}
            {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
        </div>
    );
}
