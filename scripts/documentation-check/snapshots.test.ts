import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDocumentationCheck } from "../check-documentation.js";
import { gitSnapshot, workspace } from "./scope.js";
import { cleanFixtures, cli, commit, fixture, git, put, repositoryRoot, runCli, volume } from "./fixtures.js";

afterEach(cleanFixtures);

describe("documentation snapshot and CLI boundaries", () => {
    it.each(["workspace", "staged", "ci"] as const)("recognizes repository root directories in %s snapshots", (mode) => {
        const root = fixture();
        const snapshot = mode === "workspace" ? workspace(root) : gitSnapshot(root, mode);
        expect(snapshot.exists(".")).toBe(true);
        expect(snapshot.exists("./")).toBe(true);
    });

    it.each(["workspace", "staged", "ci"] as const)("accepts legal repository root links in %s mode", (mode) => {
        const root = fixture({ "docs/source.md": "[root](../)\n" });
        const base = git(root, "rev-parse", "HEAD");
        expect(runDocumentationCheck(root, { mode, base }).failures).toEqual([]);
    });

    it("uses index sources and targets even when workspace has repaired an invalid index", () => {
        const root = fixture({ "docs/a.md": "# Old\n" });
        put(root, "docs/a.md", "# New\n[bad](#missing)\n");
        git(root, "add", "docs/a.md");
        put(root, "docs/a.md", "# New\n");
        expect(runDocumentationCheck(root, { mode: "staged" }).failures).toContainEqual(expect.stringContaining("#missing"));
        expect(runDocumentationCheck(root).failures).toEqual([]);
    });

    it("ignores broken workspace targets and metadata when the index snapshot is valid", () => {
        const root = fixture({ "docs/book.md": "# Book\n" });
        put(root, "docs/book/01.md", volume() + "[parent](../book.md#book)\n");
        git(root, "add", "docs/book/01.md");
        put(root, "docs/book.md", "# Renamed\n");
        put(root, "docs/book/01.md", "# Bad metadata\n[bad](#missing)\n");
        expect(runDocumentationCheck(root, { mode: "staged" }).failures).toEqual([]);
        expect(runDocumentationCheck(root).failures.length).toBeGreaterThan(0);
    });

    it("does not resurrect an index-deleted target from a workspace recreation", () => {
        const root = fixture({ "docs/a.md": "[target](target.md)\n", "docs/target.md": "# Target\n" });
        git(root, "rm", "docs/target.md");
        put(root, "docs/target.md", "# Target\n");
        expect(runDocumentationCheck(root, { mode: "staged" }).failures).toContainEqual(expect.stringContaining("目标不存在"));
        expect(runDocumentationCheck(root).failures).toEqual([]);
    });

    it("handles rename, deletion and spaces without splitting names", () => {
        const root = fixture({ "docs/old name.md": "# Old\n", "docs/inbound.md": "[old](<old name.md#old>)\n" });
        git(root, "mv", "docs/old name.md", "docs/new name.md");
        const report = runDocumentationCheck(root, { mode: "staged" });
        expect(report.changedFiles).toEqual(["docs/new name.md", "docs/old name.md"]);
        expect(report.failures).toContainEqual(expect.stringContaining("old name.md"));
        put(root, "docs/inbound.md", "[new](<new name.md#old>)\n");
        git(root, "add", "docs/inbound.md");
        expect(runDocumentationCheck(root, { mode: "staged" }).failures).toEqual([]);
        rmSync(resolve(root, "docs/new name.md"));
        expect(runDocumentationCheck(root).failures).toContainEqual(expect.stringContaining("目标不存在"));
    });

    it("checks added whitespace from staged bytes, not workspace bytes", () => {
        const root = fixture();
        put(root, "docs/new.md", "# New ");
        git(root, "add", "docs/new.md");
        put(root, "docs/new.md", "# New\n");
        expect(runDocumentationCheck(root, { mode: "staged" }).failures).toContainEqual(expect.stringContaining("空白"));
        put(root, "docs/new.md", "# New\n");
        git(root, "add", "docs/new.md");
        put(root, "docs/new.md", "# New ");
        expect(runDocumentationCheck(root, { mode: "staged" }).failures).toEqual([]);
    });

    it("checks an entire multi-commit CI event against its explicit baseline at HEAD", () => {
        const root = fixture();
        const base = git(root, "rev-parse", "HEAD");
        put(root, "docs/first.md", "# First\n[bad](#missing)\n");
        commit(root);
        put(root, "docs/second.md", "# Second\n");
        commit(root);
        put(root, "docs/first.md", "# First\n");
        const report = runDocumentationCheck(root, { mode: "ci", base });
        expect(report.changedFiles).toEqual(["docs/first.md", "docs/second.md"]);
        expect(report.failures).toContainEqual(expect.stringContaining("#missing"));
        expect(report.baseline).toBe(base);
    });

    it("selects PR base, push before and the manual dispatch default", () => {
        const root = fixture();
        const base = git(root, "rev-parse", "HEAD");
        put(root, "docs/new.md", "# New\n");
        commit(root);
        const previous = git(root, "rev-parse", "HEAD");
        put(root, "docs/other.md", "# Other\n");
        commit(root);
        const pr = runDocumentationCheck(root, { mode: "ci", eventName: "pull_request", event: { pull_request: { base: { sha: base } } } });
        const push = runDocumentationCheck(root, { mode: "ci", eventName: "push", event: { before: base } });
        expect(pr.baseline).toBe(base);
        expect(push.baseline).toBe(base);
        const dispatch = runDocumentationCheck(root, { mode: "ci", eventName: "workflow_dispatch", event: {} });
        expect(dispatch.baseline).toBe(previous);
        expect(dispatch.baselineReason).toMatch(/previous commit/u);
        expect(dispatch.changedFiles).toEqual(["docs/other.md"]);
        const targeted = runDocumentationCheck(root, { mode: "ci", eventName: "workflow_dispatch", event: { inputs: { base } } });
        expect(targeted.baseline).toBe(base);
        expect(targeted.baselineReason).toMatch(/base input/u);
        const firstPush = runDocumentationCheck(root, { mode: "ci", eventName: "push", event: { before: "0".repeat(40) } });
        expect(firstPush.baseline).toBe("empty-tree");
        expect(firstPush.baselineReason).toMatch(/first push/u);
        expect(firstPush.addedFiles).toContain("README.md");
        const full = runDocumentationCheck(root, { mode: "ci", eventName: "workflow_dispatch", event: { inputs: { base: "full" } } });
        expect(full.baseline).toBe("empty-tree");
        expect(full.baselineReason).toMatch(/requested/u);
        expect(full.addedFiles).toContain("README.md");
    });

    it("falls back to the full tree when a manual dispatch has no previous commit", () => {
        const root = fixture();
        const report = runDocumentationCheck(root, { mode: "ci", eventName: "workflow_dispatch", event: {} });
        expect(report.baseline).toBe("empty-tree");
        expect(report.baselineReason).toMatch(/initial commit/u);
    });

    it("fails closed on bad or absent required CI baseline and reports CLI errors", () => {
        const root = fixture();
        expect(() => runDocumentationCheck(root, { mode: "ci", base: "missing-sha" })).toThrow(/基线/u);
        expect(() => runDocumentationCheck(root, { mode: "ci", eventName: "pull_request", event: {} })).toThrow(/基线/u);
        const result = cli(root, "--base", "missing-sha");
        expect(result.status).toBe(1);
        expect(result.stdout + result.stderr).toContain("基线");
        expect(cli(root, "--unknown").status).toBe(1);
        expect(cli(root, "--staged", "--ci").status).toBe(1);
    });

    it("resolves the owning repository when CLI starts from another directory", () => {
        fixture();
        const result = cli(undefined);
        const report: unknown = JSON.parse(result.stdout);
        expect(report).toMatchObject({ mode: "workspace", baseline: git(repositoryRoot, "rev-parse", "HEAD") });
    });

    it("reads CI event files and checks added Markdown from committed HEAD bytes", () => {
        const root = fixture({ "docs/book.md": "# Book\n" });
        const base = git(root, "rev-parse", "HEAD");
        put(root, "docs/book/01.md", "# Bad \n[bad](#missing)");
        commit(root);
        put(root, "docs/book/01.md", volume());
        put(root, "event.json", JSON.stringify({ pull_request: { base: { sha: base } } }));
        const result = runCli(root, ["--ci"], { GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: resolve(root, "event.json") });
        expect(result.status).toBe(1);
        expect(JSON.parse(result.stdout)).toMatchObject({ mode: "ci", baseline: base, addedFiles: ["docs/book/01.md"] });
        expect(result.stdout).toContain("锚点");
        expect(result.stdout).toContain("分册元数据");
        expect(result.stdout).toContain("空白");
        const dispatchBase = git(root, "rev-parse", "HEAD^");
        for (const [eventName, event, expected] of [
            ["push", { before: base }, base],
            ["workflow_dispatch", {}, dispatchBase],
            ["workflow_dispatch", { inputs: { base } }, base],
            ["workflow_dispatch", { inputs: { base: "full" } }, "empty-tree"],
            ["push", { before: "0".repeat(40) }, "empty-tree"],
        ] as const) {
            put(root, "event.json", JSON.stringify(event));
            const eventResult = runCli(root, ["--ci"], { GITHUB_EVENT_NAME: eventName, GITHUB_EVENT_PATH: resolve(root, "event.json") });
            expect(eventResult.status).toBe(1);
            expect(JSON.parse(eventResult.stdout).baseline).toBe(expected);
        }
    });

    it("executes actual CLI red then repair green for all new gate families", () => {
        const root = fixture({ "docs/book.md": "# Book\n" });
        put(root, "docs/book/01.md", "# Volume \n[bad](#missing)");
        const red = cli(root);
        expect(red.status).toBe(1);
        expect(red.stdout).toContain("锚点");
        expect(red.stdout).toContain("分册元数据");
        expect(red.stdout).toContain("空白");
        put(root, "docs/book/01.md", volume());
        const green = cli(root);
        expect(green.status).toBe(0);
        expect(JSON.parse(green.stdout).failures).toEqual([]);
    });
});
