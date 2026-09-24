import { join, relative, resolve } from "node:path";
import { readdir, stat } from "node:fs/promises";
import { CollectionPlanRevisionConflictError, SourceRevisionConflictError } from "@cosmos/application";
import { PrismaClient } from "@prisma/client";
import { createDiagnosedPrismaClient, sqliteDiagnosticsEnabled } from "./sqlite-diagnostics.js";

export interface StorageRoots {
    dataRoot: string;
    databasePath: string;
    databaseUrl: string;
    blobRoot: string;
    artifactRoot: string;
    cacheRoot: string;
    logRoot: string;
    secretRoot: string;
}

export function resolveStorageRoots(
    dataRoot = process.env.COSMOS_DATA_ROOT?.trim() || ".cosmos",
    workspaceRoot = process.env.COSMOS_WORKSPACE_ROOT ?? process.cwd(),
): StorageRoots {
    const root = resolve(workspaceRoot, dataRoot);
    const databasePath = join(root, "cosmos.sqlite");

    return {
        dataRoot: root,
        databasePath,
        databaseUrl: `file:${databasePath.replaceAll("\\", "/")}`,
        blobRoot: join(root, "blobs"),
        artifactRoot: join(root, "artifacts"),
        cacheRoot: join(root, "cache"),
        logRoot: join(root, "logs"),
        secretRoot: join(root, "secrets"),
    };
}

export function createPrismaClient(
    dataRoot = process.env.COSMOS_DATA_ROOT?.trim() || ".cosmos",
): PrismaClient {
    const roots = resolveStorageRoots(dataRoot);
    const url = process.env.DATABASE_URL || roots.databaseUrl;

    // 开关关掉时构造参数与以前逐字相同：不注册任何 log 事件。
    return sqliteDiagnosticsEnabled()
        ? createDiagnosedPrismaClient(url)
        : new PrismaClient({ datasources: { db: { url } } });
}

export function resolveContainedPath(root: string, child: string): string {
    const resolvedRoot = resolve(root);
    const resolvedChild = resolve(resolvedRoot, child);
    const childRelativeToRoot = relative(resolvedRoot, resolvedChild);

    if (
        childRelativeToRoot.startsWith("..") ||
        childRelativeToRoot.includes(":") ||
        resolve(resolvedRoot, childRelativeToRoot) !== resolvedChild
    ) {
        throw new Error("Path escapes the configured storage root.");
    }

    return resolvedChild;
}

export async function fileSize(path: string): Promise<number> {
    const info = await stat(path).catch(() => null);
    return info?.isFile() ? info.size : 0;
}

export async function directorySize(root: string): Promise<{ bytes: number; fileCount: number }> {
    const queue: string[] = [root];
    let bytes = 0;
    let fileCount = 0;
    while (queue.length > 0) {
        const current = queue.pop()!;
        let entries: import("node:fs").Dirent[];
        try {
            entries = await readdir(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const full = join(current, entry.name);
            if (entry.isDirectory()) {
                queue.push(full);
            } else if (entry.isFile()) {
                const info = await stat(full).catch(() => null);
                if (info) {
                    bytes += info.size;
                    fileCount += 1;
                }
            }
        }
    }
    return { bytes, fileCount };
}

export function parseSourceRevisionId(sourceId: string, revisionId: string): number {
    return parseRevisionId(revisionId, sourceId, () => new SourceRevisionConflictError(sourceId));
}

/**
 * 计划 revision 的解析与来源同形但报计划自己的冲突错误：两者是独立的 CAS 域
 * （ADR-0023 决策 2），拿来源的冲突类型回报计划的并发写会误导调用方。
 */
export function parsePlanRevisionId(planId: string, revisionId: string): number {
    return parseRevisionId(revisionId, planId, () => new CollectionPlanRevisionConflictError(planId));
}

function parseRevisionId(
    revisionId: string,
    ownerId: string,
    conflict: () => Error,
): number {
    const prefix = `${ownerId}:`;
    if (!revisionId.startsWith(prefix) || revisionId.length === prefix.length) {
        throw conflict();
    }
    const rawRevision = revisionId.slice(prefix.length);
    if (!/^[1-9][0-9]*$/.test(rawRevision)) {
        throw conflict();
    }
    const revision = Number(rawRevision);
    if (!Number.isSafeInteger(revision) || revision < 1) {
        throw conflict();
    }
    return revision;
}

