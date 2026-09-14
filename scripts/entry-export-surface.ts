#!/usr/bin/env bun
/**
 * 打印包入口「解析后」的导出面(名称 + 类型/值),供治理前后做零 diff 比对。
 *
 * 为什么要用编译器 API 而不是扫源码:`export *` 的导出名要跨文件解析,正则扫不出来;
 * 类型导出(interface/type)在运行时不存在,只看 Object.keys 会漏掉半个合同。
 *
 * 用法:bun run scripts/entry-export-surface.ts <entry.ts> [--out <file>]
 * 输出:每行 `value|type <TAB> <名称>`,按名称排序;计数与诊断走 stderr。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";

function fail(message: string): never {
    process.stderr.write(`${message}\n`);
    process.exit(1);
}

/** 从入口文件向上找到最近的 tsconfig.json:入口的解析规则(路径别名、NodeNext)由它决定。 */
function findTsconfig(startDir: string): string {
    let dir = startDir;
    for (;;) {
        const candidate = resolve(dir, "tsconfig.json");
        if (ts.sys.fileExists(candidate)) {
            return candidate;
        }
        const parent = dirname(dir);
        if (parent === dir) {
            fail(`找不到 tsconfig.json:${startDir}`);
        }
        dir = parent;
    }
}

function classify(checker: ts.TypeChecker, symbol: ts.Symbol): "value" | "type" {
    const target =
        symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const flags = target.flags;
    if (flags & (ts.SymbolFlags.Value | ts.SymbolFlags.Namespace)) {
        return "value";
    }
    if (flags & (ts.SymbolFlags.Type | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Interface)) {
        return "type";
    }
    return "type";
}

function main(): void {
    const args = process.argv.slice(2);
    const entryArg = args.find((arg) => !arg.startsWith("--"));
    if (!entryArg) {
        fail("用法:bun run scripts/entry-export-surface.ts <entry.ts> [--out <file>]");
    }
    const outIndex = args.indexOf("--out");
    const outPath = outIndex === -1 ? undefined : args[outIndex + 1];
    const entry = resolve(entryArg);

    const tsconfigPath = findTsconfig(dirname(entry));
    const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    if (configFile.error) {
        fail(`tsconfig 读取失败:${ts.flattenDiagnosticMessageText(configFile.error.messageText, " ")}`);
    }
    const parsed = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        dirname(tsconfigPath),
        { noEmit: true },
        tsconfigPath,
    );

    const program = ts.createProgram(parsed.fileNames, parsed.options);
    const source = program.getSourceFile(entry);
    if (!source) {
        fail(`入口不在编译单元内:${entry}`);
    }
    const moduleSymbol = program.getTypeChecker().getSymbolAtLocation(source);
    if (!moduleSymbol) {
        fail(`入口不是模块:${entry}`);
    }

    const checker = program.getTypeChecker();
    const exports = checker
        .getExportsOfModule(moduleSymbol)
        .map((symbol) => `${classify(checker, symbol)}\t${symbol.getName()}`)
        .sort();

    const body = `${exports.join("\n")}\n`;
    if (outPath) {
        mkdirSync(dirname(resolve(outPath)), { recursive: true });
        writeFileSync(resolve(outPath), body, "utf8");
        process.stderr.write(`写入 ${outPath}:${exports.length} 个导出\n`);
    } else {
        process.stdout.write(body);
        process.stderr.write(`共 ${exports.length} 个导出\n`);
    }
}

main();
