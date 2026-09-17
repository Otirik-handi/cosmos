import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const cliRelativePath = join("prisma", "build", "index.js");

// src/ 与编译产物 dist/ 都在包根下一层，包根是两套 node_modules 布局共用的稳定锚点。
const defaultPackageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function describeResolutionFailure(error: unknown): string {
    if (error instanceof Error) {
        const { code } = error as Error & { code?: string };
        return code ?? error.message;
    }
    return String(error);
}

function storeEntryVersion(entry: string): number[] {
    const match = /^prisma@(\d+(?:\.\d+)*)/.exec(entry);
    return match ? match[1].split(".").map((part) => Number(part)) : [];
}

function compareStoreEntries(left: string, right: string): number {
    const leftVersion = storeEntryVersion(left);
    const rightVersion = storeEntryVersion(right);
    for (let index = 0; index < Math.max(leftVersion.length, rightVersion.length); index += 1) {
        const difference = (leftVersion[index] ?? 0) - (rightVersion[index] ?? 0);
        if (difference !== 0) {
            return difference;
        }
    }
    return left.localeCompare(right);
}

function findBunStoreCliPath(directory: string): string | undefined {
    const storeRoot = join(directory, "node_modules", ".bun");
    let entries: string[];
    try {
        entries = readdirSync(storeRoot);
    } catch {
        return undefined;
    }
    return entries
        .filter((entry) => entry.startsWith("prisma@"))
        .sort(compareStoreEntries)
        .reverse()
        .map((entry) => join(storeRoot, entry, "node_modules", cliRelativePath))
        .find((cliPath) => existsSync(cliPath));
}

/**
 * 解析 Prisma CLI 入口文件。
 *
 * node_modules 布局随 bun 版本与 lock 文件变化：生成的布局可能把 CLI 放在
 * storage-prisma 包的 node_modules、提升到工作区根，或只解包到 bun store，
 * 所以调用方不得假定单一位置。`from` 默认是 storage-prisma 包根。
 */
export function resolvePrismaCliPath(from: string = defaultPackageRoot): string {
    const searchedFrom = resolve(from);
    const tried: string[] = [];

    // Node 模块解析已覆盖嵌套软链与提升两种真实布局，先交给它。
    try {
        return createRequire(pathToFileURL(join(searchedFrom, "package.json")))
            .resolve(cliRelativePath);
    } catch (error) {
        tried.push(`module resolution from ${searchedFrom} (${describeResolutionFailure(error)})`);
    }

    // 兜底：逐级向上按字面路径查找（依赖的 exports 收窄子路径时模块解析会失败），
    // 再覆盖只解包到 bun store 的布局。
    for (let directory = searchedFrom; ; directory = dirname(directory)) {
        const cliPath = join(directory, "node_modules", cliRelativePath);
        if (existsSync(cliPath)) {
            return cliPath;
        }
        tried.push(cliPath);
        const storeCliPath = findBunStoreCliPath(directory);
        if (storeCliPath) {
            return storeCliPath;
        }
        if (directory === dirname(directory)) {
            break;
        }
    }

    throw new Error([
        `Unable to locate the Prisma CLI (${cliRelativePath}).`,
        "Tried:",
        ...tried.map((entry) => `  ${entry}`),
        "Run `bun install` in the workspace root, then retry.",
    ].join("\n"));
}
