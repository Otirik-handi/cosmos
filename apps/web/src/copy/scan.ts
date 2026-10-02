import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * 界面文案扫描（E6 的门禁内核）。
 *
 * 判据：**会进入界面**的中文字面量——JSX 文本、字符串/模板字面量、`aria-label` /
 * `placeholder` / `title` / `summary` 之类面向用户的属性值。注释、`className`、
 * `data-*` 锚点、`console` 日志、类型名都不算。
 *
 * 用法（迁移进度随时可量化）：
 *   bun run apps/web/src/copy/scan.ts                 # 打印剩余内联文案
 *   bun run apps/web/src/copy/scan.ts --write-baseline # 重写基线（只应删除条目）
 */

/** 产品源码根；相对本文件位置解析，测试与命令行两种入口都能用。 */
export const SOURCE_ROOT = path.resolve(import.meta.dirname, "..");

/** 组件实验室是开发期工具，用固定 fixture；它的夹具文案不进产品文案治理。 */
const SKIPPED_DIRECTORIES = new Set(["copy", "component-lab"]);

/** 这些属性名不是面向用户的文案。 */
const NON_COPY_ATTRIBUTES = new Set(["className", "class", "id", "key", "href", "data-testid"]);

const CJK_PATTERN = /[\u4e00-\u9fff]/u;

/**
 * 禁用词（`ui-copy-review-v1` §D/§E 与术语表 B/C 组）：用户可见文案里不允许出现。
 * 「分类」在它被定义前界面只用「标签」和「已保存视图」；`Spotlight` 一律叫「热点」。
 */
export const BANNED_UI_TERMS = [
    "分类",
    "历史壳",
    "未注册",
    "Spotlight",
    "Story ID",
    "受管理 subtype",
    "审计",
    "不变量",
    "provenance",
    "policy/version",
    "Revision",
] as const;

export type InlineCopyHit = {
    /** `jsx` | `literal` | `template` | `attr:<name>` */
    kind: string;
    value: string;
    /** 源码里的行号（1 起）。 */
    line: number;
};

export type InlineCopyReport = {
    /** 相对 `SOURCE_ROOT` 的路径 → 该文件里的命中。 */
    files: Map<string, InlineCopyHit[]>;
    /** 命中禁用词的位置。 */
    banned: { file: string; line: number; term: string; value: string }[];
};

/**
 * 误报豁免：这些词里**合法地**含有禁用词，逐字替换会把术语表裁定的正确用词打掉。
 * 「细分类型」是 `subtype` 的裁定译名（`ui-copy-review-v1` B 组），里面恰好有「分类」两字。
 */
const BANNED_TERM_FALSE_POSITIVES = ["细分类型"] as const;

/** 去掉豁免词之后再判禁用词，避免「细分类型」被「分类」误伤。 */
export function findBannedTerms(value: string): string[] {
    let remainder = value;
    for (const allowed of BANNED_TERM_FALSE_POSITIVES) {
        remainder = remainder.split(allowed).join("");
    }
    return BANNED_UI_TERMS.filter((term) => remainder.includes(term));
}

function listSourceFiles(directory: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            if (SKIPPED_DIRECTORIES.has(entry.name)) {
                continue;
            }
            listSourceFiles(full, out);
            continue;
        }
        if (!/\.(ts|tsx)$/u.test(entry.name) || /\.test\.(ts|tsx)$/u.test(entry.name)) {
            continue;
        }
        out.push(full.split(path.sep).join("/"));
    }
    return out;
}

function attributeNameOf(node: ts.Node): string | null {
    const parent = node.parent;
    return parent !== undefined && ts.isJsxAttribute(parent) ? parent.name.getText() : null;
}

/** 扫一个文件，返回会进入界面的中文字面量。 */
function scanFile(file: string): InlineCopyHit[] {
    const source = fs.readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const hits: InlineCopyHit[] = [];
    const lineOf = (node: ts.Node): number =>
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

    const visit = (node: ts.Node): void => {
        if (ts.isJsxText(node)) {
            const text = node.text.trim();
            if (CJK_PATTERN.test(text)) {
                hits.push({ kind: "jsx", value: text, line: lineOf(node) });
            }
        } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
            const attribute = attributeNameOf(node);
            const skipped = attribute !== null
                && (NON_COPY_ATTRIBUTES.has(attribute) || attribute.startsWith("data-"));
            const isModuleSpecifier = ts.isImportDeclaration(node.parent)
                || ts.isExportDeclaration(node.parent)
                || (ts.isLiteralTypeNode(node.parent) === false && ts.isImportTypeNode(node.parent));
            if (!skipped && !isModuleSpecifier && CJK_PATTERN.test(node.text)) {
                hits.push({
                    kind: attribute === null ? "literal" : `attr:${attribute}`,
                    value: node.text,
                    line: lineOf(node),
                });
            }
        } else if (ts.isTemplateExpression(node)) {
            const text = node.getText(sourceFile).replace(/\s+/gu, " ");
            if (CJK_PATTERN.test(text)) {
                hits.push({ kind: "template", value: text, line: lineOf(node) });
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return hits;
}

/** 扫描产品源码，给出内联文案与禁用词命中。 */
export function scanInlineCopy(root: string = SOURCE_ROOT): InlineCopyReport {
    const files = new Map<string, InlineCopyHit[]>();
    const banned: InlineCopyReport["banned"] = [];
    for (const file of listSourceFiles(root)) {
        const hits = scanFile(file);
        if (hits.length === 0) {
            continue;
        }
        const relative = path.relative(root, file).split(path.sep).join("/");
        files.set(relative, hits);
        for (const hit of hits) {
            for (const term of findBannedTerms(hit.value)) {
                banned.push({ file: relative, line: hit.line, term, value: hit.value });
            }
        }
    }
    return { files, banned };
}

function main(): void {
    const report = scanInlineCopy();
    const entries = [...report.files].sort(([left], [right]) => left.localeCompare(right));
    const total = entries.reduce((sum, [, hits]) => sum + hits.length, 0);
    console.log(`内联文案：${total} 处 / ${entries.length} 个文件`);
    console.log(`禁用词命中：${report.banned.length} 处`);

    if (process.argv.includes("--write-baseline")) {
        const baseline = Object.fromEntries(entries.map(([file, hits]) => [file, hits.length]));
        const target = path.join(import.meta.dirname, "inline-copy-baseline.json");
        fs.writeFileSync(target, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
        console.log(`已写入基线：${target}`);
        return;
    }

    for (const [file, hits] of entries) {
        console.log(`\n${file} (${hits.length})`);
        for (const hit of hits) {
            console.log(`  ${hit.line}  [${hit.kind}] ${hit.value}`);
        }
    }
    for (const item of report.banned) {
        console.log(`\n禁用词 "${item.term}" @ ${item.file}:${item.line} — ${item.value}`);
    }
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("scan.ts")) {
    main();
}
