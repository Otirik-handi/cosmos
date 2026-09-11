import { join, relative, resolve } from "node:path";
import { readdir, stat } from "node:fs/promises";
import { SourceRevisionConflictError } from "@cosmos/application";
import { PrismaClient } from "@prisma/client";

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

    return new PrismaClient({
        datasources: {
            db: {
                url: process.env.DATABASE_URL || roots.databaseUrl,
            },
        },
    });
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
    const prefix = `${sourceId}:`;
    if (!revisionId.startsWith(prefix) || revisionId.length === prefix.length) {
        throw new SourceRevisionConflictError(sourceId);
    }
    const rawRevision = revisionId.slice(prefix.length);
    if (!/^[1-9][0-9]*$/.test(rawRevision)) {
        throw new SourceRevisionConflictError(sourceId);
    }
    const revision = Number(rawRevision);
    if (!Number.isSafeInteger(revision) || revision < 1) {
        throw new SourceRevisionConflictError(sourceId);
    }
    return revision;
}

