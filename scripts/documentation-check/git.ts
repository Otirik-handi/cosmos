import { spawnSync } from "node:child_process";
import type { CheckOptions } from "./report.js";

export function git(root: string, args: readonly string[], input?: string): string {
    const result = spawnSync("git", [...args], {
        cwd: root, encoding: "utf8", windowsHide: true, input, maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
        throw new Error(`Git 检查失败：${args[0]}：${result.error?.message ?? result.stderr.trim()}`);
    }
    return result.stdout;
}

export function emptyTree(root: string): string {
    return git(root, ["hash-object", "-t", "tree", "--stdin"], "").trim();
}

function field(value: unknown, key: string): unknown {
    return typeof value === "object" && value !== null && key in value
        ? Reflect.get(value, key) : undefined;
}

export function baseline(root: string, options: CheckOptions): { ref: string; label: string; reason: string } {
    let candidate = options.base;
    let reason = candidate ? "explicit --base" : "HEAD";
    if (!candidate && options.mode === "ci") {
        const event = options.event;
        if (options.eventName === "pull_request" || options.eventName === "pull_request_target") {
            const sha = field(field(field(event, "pull_request"), "base"), "sha");
            if (typeof sha === "string" && sha) candidate = sha;
            reason = "pull_request base SHA";
        } else if (options.eventName === "push") {
            const before = field(event, "before");
            if (typeof before === "string" && /^0{40,64}$/u.test(before)) {
                return { ref: emptyTree(root), label: "empty-tree", reason: "first push: full HEAD tree" };
            }
            if (typeof before === "string" && before) candidate = before;
            reason = "push before SHA";
        } else if (options.eventName === "workflow_dispatch") {
            // 手动触发没有 before SHA；默认对比上一个提交，避免把封口归档整树按新增处理。
            const requested = field(field(event, "inputs"), "base");
            const manual = typeof requested === "string" ? requested.trim() : "";
            if (manual === "full") {
                return { ref: emptyTree(root), label: "empty-tree", reason: "manual dispatch: full HEAD tree (requested)" };
            }
            if (manual) {
                candidate = manual;
                reason = "manual dispatch base input";
            } else {
                const parent = spawnSync("git", ["rev-parse", "--verify", "--quiet", "HEAD^"], { cwd: root, encoding: "utf8", windowsHide: true });
                if (parent.status !== 0) {
                    return { ref: emptyTree(root), label: "empty-tree", reason: "manual dispatch: initial commit" };
                }
                return { ref: parent.stdout.trim(), label: parent.stdout.trim(), reason: "manual dispatch: previous commit" };
            }
        }
        if (!candidate) throw new Error(`CI 比较基线缺失：${options.eventName ?? "unknown event"}；请提供 --base`);
    }
    if (candidate) {
        try {
            const ref = git(root, ["rev-parse", "--verify", "--end-of-options", `${candidate}^{commit}`]).trim();
            return { ref, label: ref, reason };
        } catch {
            throw new Error(`比较基线不可访问：${candidate}；请获取完整历史或提供有效 --base`);
        }
    }
    const head = spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true });
    if (head.status === 0) return { ref: head.stdout.trim(), label: head.stdout.trim(), reason };
    // An unborn repository is distinct from a missing requested CI baseline.
    git(root, ["rev-parse", "--git-dir"]);
    return { ref: emptyTree(root), label: "empty-tree", reason: "unborn HEAD: all current files" };
}

export function changes(root: string, ref: string, mode: string): { changed: string[]; added: string[] } {
    const tail = mode === "staged" ? ["--cached"] : mode === "ci" ? ["HEAD"] : [];
    const rows = git(root, ["diff", "--name-status", "-z", "--find-renames", ref, ...tail, "--"]).split("\0");
    const changed = new Set<string>();
    const added = new Set<string>();
    for (let i = 0; i < rows.length && rows[i];) {
        const status = rows[i++];
        const path = rows[i++];
        if (!path) throw new Error("无法解析 Git 变更路径");
        changed.add(path);
        if (status.startsWith("R") || status.startsWith("C")) {
            const destination = rows[i++];
            if (!destination) throw new Error("无法解析 Git 改名路径");
            changed.add(destination);
            if (status.startsWith("C")) added.add(destination);
        } else if (status === "A") added.add(path);
    }
    if (mode === "workspace") {
        for (const path of git(root, ["ls-files", "-z", "--others", "--exclude-standard"]).split("\0").filter(Boolean)) {
            changed.add(path);
            added.add(path);
        }
    }
    return { changed: [...changed].sort(), added: [...added].sort() };
}
