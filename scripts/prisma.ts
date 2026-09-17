import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { resolvePrismaCliPath } from "../packages/storage-prisma/src/prisma-cli.js";

const rootDirectory = resolve(import.meta.dirname, "..");
const configuredDataRoot = process.env.COSMOS_DATA_ROOT?.trim();
const dataRoot = resolve(
    rootDirectory,
    configuredDataRoot || ".cosmos",
);
const databasePath = resolve(dataRoot, "cosmos.sqlite");
const schemaPath = "packages/storage-prisma/prisma/schema.prisma";

mkdirSync(dirname(databasePath), { recursive: true });
if (!existsSync(databasePath)) {
    writeFileSync(databasePath, new Uint8Array());
}

const args = process.argv.slice(2);
if (args.length === 0) {
    throw new Error("Usage: bun run scripts/prisma.ts <prisma command> [args]");
}

// 放在参数校验之后：无参数调用必须仍然先报 Usage，而不是解析失败。
const prismaCli = resolvePrismaCliPath();

const result = spawnSync(
    process.execPath,
    [
        prismaCli,
        ...args,
        "--schema",
        schemaPath,
    ],
    {
        cwd: rootDirectory,
        env: {
            ...process.env,
            DATABASE_URL: process.env.DATABASE_URL
                || `file:${databasePath.replaceAll("\\", "/")}`,
        },
        stdio: "inherit",
    },
);

if (result.error) {
    throw result.error;
}

process.exit(result.status ?? 1);
