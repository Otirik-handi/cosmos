"use client";

import { useEffect, useState } from "react";

import {
    connectorStateExportSchema,
    type BackupSnapshot,
    type ConnectorStateImportResult,
    type ConnectorStateNamespaceSummary,
    type ConnectorStateExportScope,
    type StorageStats,
} from "@cosmos/contracts";
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

/**
 * 把导出件作为文件交给用户保存。文件名与 API 的 `Content-Disposition` 用同一约定
 * （时间戳里的 `:` 换成 `-`，否则在 Windows 上是非法字符）。
 */
function downloadJson(prefix: string, exportedAt: string, payload: unknown): void {
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
        type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${prefix}-${exportedAt.replaceAll(":", "-")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
}

function describeImport(result: ConnectorStateImportResult): string {
    const mode = result.mode === "overwrite" ? "覆盖本地" : "只补缺失";
    return `已导入（${mode}）：新增 ${result.created}、覆盖 ${result.overwritten}、`
        + `跳过 ${result.skipped}，共 ${result.namespaces} 个抽屉。`;
}

type StoragePanelProps = {
    client: HttpCosmosClient;
};

/**
 * 存储面板（ADR-0019 / OPS-003/004）：展示数据库/Blob/缓存等占用，提供备份
 * 列表、新建备份、恢复与用户数据导出。恢复会覆盖当前数据库，故先做一次
 * 「恢复前保护备份」。
 */
export function StoragePanel({ client }: StoragePanelProps) {
    const [stats, setStats] = useState<StorageStats | null>(null);
    const [backups, setBackups] = useState<readonly BackupSnapshot[] | null>(null);
    const [namespaces, setNamespaces] = useState<readonly ConnectorStateNamespaceSummary[]>([]);
    const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    /** 空字符串 = 全部已归属；其余值是点名一个抽屉（未归属的只能这样导出）。 */
    const [exportNamespace, setExportNamespace] = useState("");
    const [importMode, setImportMode] = useState<"skip-existing" | "overwrite">("skip-existing");
    const [importTarget, setImportTarget] = useState("");
    const [importFile, setImportFile] = useState<File | null>(null);

    const load = (): void => {
        Promise.all([
            client.storageStats(),
            client.listBackups(),
            client.listConnectorStateNamespaces(),
        ])
            .then(([statsResult, backupResult, namespaceResult]) => {
                setStats(statsResult);
                setBackups(backupResult);
                setNamespaces(namespaceResult);
                setState("loaded");
            })
            .catch(() => setState("error"));
    };

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            client.storageStats(),
            client.listBackups(),
            client.listConnectorStateNamespaces(),
        ])
            .then(([statsResult, backupResult, namespaceResult]) => {
                if (!cancelled) {
                    setStats(statsResult);
                    setBackups(backupResult);
                    setNamespaces(namespaceResult);
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

    const exportUserData = (): void => {
        setBusy(true);
        setMessage(null);
        client.exportUserData()
            .then((payload) => {
                downloadJson("cosmos-user-data", payload.exportedAt, payload);
                const { labels, collections, annotations, savedViews, boards } = payload.counts;
                setMessage(
                    `已导出：标签 ${labels}、收藏夹 ${collections}、批注 ${annotations}、`
                    + `查询视图 ${savedViews}、看板 ${boards}。`,
                );
            })
            .catch(() => setMessage("导出失败。"))
            .finally(() => setBusy(false));
    };

    const exportConnectorState = (): void => {
        setBusy(true);
        setMessage(null);
        const scope: ConnectorStateExportScope = exportNamespace === ""
            ? { kind: "attributed" }
            : { kind: "namespace", namespace: exportNamespace };
        client.exportConnectorState(scope)
            .then((payload) => {
                downloadJson("cosmos-connector-state", payload.exportedAt, payload);
                setMessage(
                    `已导出连接器状态：${payload.counts.namespaces} 个抽屉、${payload.counts.keys} 条。`,
                );
            })
            .catch(() => setMessage("连接器状态导出失败。"))
            .finally(() => setBusy(false));
    };

    const importConnectorState = (): void => {
        if (!importFile) {
            setMessage("先选择一个导出件再导入。");
            return;
        }
        setBusy(true);
        setMessage(null);
        // 先在本地按契约解析一次：选错文件时给出「不是导出件」而不是服务端 400。
        importFile.text()
            .then((text) => connectorStateExportSchema.parse(JSON.parse(text) as unknown))
            .then((payload) => client.importConnectorState({
                mode: importMode,
                ...(importTarget.trim() === "" ? {} : { targetNamespace: importTarget.trim() }),
                export: payload,
            }))
            .then((result) => setMessage(describeImport(result)))
            .catch(() => setMessage("连接器状态导入失败：文件不是状态导出件，或目标抽屉没有归属登记。"))
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
                <Button size="xs" variant="outline" disabled={busy} onClick={exportUserData}>导出用户数据</Button>
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
            <div className="flex flex-col gap-1.5 rounded-sm border bg-card px-3 py-2 text-xs">
                <span className="font-medium">连接器状态（ING-012）</span>
                <span className="text-muted-foreground">
                    采集计划记住的 ETag／游标等可重建状态。导出件只含这些状态，不含 Secret；
                    「未归属」的抽屉只能按名字点名导出。
                </span>
                <div className="flex flex-wrap items-center gap-2">
                    <select
                        aria-label="连接器状态导出范围"
                        className="h-7 max-w-[16rem] rounded-sm border bg-background px-2 text-xs"
                        value={exportNamespace}
                        disabled={busy}
                        onChange={(event) => setExportNamespace(event.target.value)}
                    >
                        <option value="">全部已归属</option>
                        {namespaces.map((item) => (
                            <option key={item.namespace} value={item.namespace}>
                                {`${item.namespace}（${item.keyCount} 条${item.unattributed ? "，未归属" : ""}）`}
                            </option>
                        ))}
                    </select>
                    <Button size="xs" variant="outline" disabled={busy} onClick={exportConnectorState}>
                        导出连接器状态
                    </Button>
                    <span className="text-muted-foreground">{namespaces.length} 个抽屉</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <input
                        aria-label="连接器状态导出件"
                        className="text-xs"
                        type="file"
                        accept="application/json,.json"
                        disabled={busy}
                        onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
                    />
                    <select
                        aria-label="连接器状态导入模式"
                        className="h-7 rounded-sm border bg-background px-2 text-xs"
                        value={importMode}
                        disabled={busy}
                        onChange={(event) => setImportMode(
                            event.target.value === "overwrite" ? "overwrite" : "skip-existing",
                        )}
                    >
                        <option value="skip-existing">只补缺失</option>
                        <option value="overwrite">覆盖本地</option>
                    </select>
                    <input
                        aria-label="连接器状态导入目标抽屉"
                        className="h-7 w-48 rounded-sm border bg-background px-2 text-xs"
                        type="text"
                        placeholder="目标抽屉（可选）"
                        value={importTarget}
                        disabled={busy}
                        onChange={(event) => setImportTarget(event.target.value)}
                    />
                    <Button size="xs" variant="outline" disabled={busy} onClick={importConnectorState}>
                        导入连接器状态
                    </Button>
                </div>
            </div>
            {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
        </div>
    );
}
