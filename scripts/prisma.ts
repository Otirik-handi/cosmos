import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const rootDirectory = resolve(import.meta.dirname, "..");
const dataRoot = resolve(
    process.env.COSMOS_DATA_ROOT ?? resolve(rootDirectory, ".cosmos"),
);
const databasePath = resolve(dataRoot, "cosmos.sqlite");
const prismaCli = "packages/storage-prisma/node_modules/prisma/build/index.js";
const schemaPath = "packages/storage-prisma/prisma/schema.prisma";

mkdirSync(dirname(databasePath), { recursive: true });
if (!existsSync(databasePath)) {
    writeFileSync(databasePath, new Uint8Array());
}

const args = process.argv.slice(2);
if (args.length === 0) {
    throw new Error("Usage: bun run scripts/prisma.ts <prisma command> [args]");
}

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
