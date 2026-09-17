import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolvePrismaCliPath } from "./prisma-cli.js";

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

function createWorkspaceRoot(): string {
    const root = mkdtempSync(join(tmpdir(), "cosmos-prisma-cli-"));
    roots.push(root);
    return root;
}

function writeCliFile(path: string): string {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "");
    return path;
}

function createPackageRoot(workspaceRoot: string): string {
    const packageRoot = join(workspaceRoot, "packages", "storage-prisma");
    mkdirSync(packageRoot, { recursive: true });
    return packageRoot;
}

describe("resolvePrismaCliPath", () => {
    it("resolves the CLI from the package's own node_modules", () => {
        const workspaceRoot = createWorkspaceRoot();
        const packageRoot = createPackageRoot(workspaceRoot);
        const expected = writeCliFile(join(
            packageRoot,
            "node_modules",
            "prisma",
            "build",
            "index.js",
        ));

        expect(resolvePrismaCliPath(packageRoot)).toBe(expected);
    });

    it("resolves the CLI when bun hoists it to an ancestor node_modules", () => {
        const workspaceRoot = createWorkspaceRoot();
        const packageRoot = createPackageRoot(workspaceRoot);
        const expected = writeCliFile(join(
            workspaceRoot,
            "node_modules",
            "prisma",
            "build",
            "index.js",
        ));

        expect(resolvePrismaCliPath(packageRoot)).toBe(expected);
    });

    it("falls back to the literal path when the dependency blocks subpath resolution", () => {
        const workspaceRoot = createWorkspaceRoot();
        const packageRoot = createPackageRoot(workspaceRoot);
        const expected = writeCliFile(join(
            packageRoot,
            "node_modules",
            "prisma",
            "build",
            "index.js",
        ));
        writeFileSync(
            join(packageRoot, "node_modules", "prisma", "package.json"),
            JSON.stringify({ name: "prisma", exports: { ".": "./build/types.js" } }),
        );

        expect(resolvePrismaCliPath(packageRoot)).toBe(expected);
    });

    it("falls back to the bun store when no package entry for Prisma exists", () => {
        const workspaceRoot = createWorkspaceRoot();
        const packageRoot = createPackageRoot(workspaceRoot);
        const expected = writeCliFile(join(
            workspaceRoot,
            "node_modules",
            ".bun",
            "prisma@6.19.3+abc123",
            "node_modules",
            "prisma",
            "build",
            "index.js",
        ));

        expect(resolvePrismaCliPath(packageRoot)).toBe(expected);
    });

    it("prefers the highest bun store version when several are unpacked", () => {
        const workspaceRoot = createWorkspaceRoot();
        const packageRoot = createPackageRoot(workspaceRoot);
        const storeRoot = join(workspaceRoot, "node_modules", ".bun");
        writeCliFile(join(
            storeRoot,
            "prisma@6.9.0+aaa111",
            "node_modules",
            "prisma",
            "build",
            "index.js",
        ));
        writeCliFile(join(
            storeRoot,
            "prisma@6.19.3+bbb222",
            "node_modules",
            "prisma",
            "build",
            "index.js",
        ));
        const newest = writeCliFile(join(
            storeRoot,
            "prisma@6.20.1+ccc333",
            "node_modules",
            "prisma",
            "build",
            "index.js",
        ));

        expect(resolvePrismaCliPath(packageRoot)).toBe(newest);
    });

    it("throws with the tried locations and the resolution failure when the CLI is missing", () => {
        const workspaceRoot = createWorkspaceRoot();
        const packageRoot = createPackageRoot(workspaceRoot);

        expect(() => resolvePrismaCliPath(packageRoot)).toThrowError(/prisma[/\\]build[/\\]index\.js/);
        expect(() => resolvePrismaCliPath(packageRoot)).toThrowError(/MODULE_NOT_FOUND/);
        expect(() => resolvePrismaCliPath(packageRoot)).toThrowError(/bun install/);
    });

    it("resolves this workspace's CLI from the storage package by default", () => {
        const resolved = resolvePrismaCliPath();

        expect(existsSync(resolved)).toBe(true);
        expect(resolved.endsWith(join("prisma", "build", "index.js"))).toBe(true);
    });
});
