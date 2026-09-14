import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as entry from "./index.js";

/**
 * 包入口契约:冻结 `@cosmos/application` 的公共导出面。
 *
 * 拆分(桶文件显式导出化、单体按聚合移出)只允许移动实现,不允许增删导出;
 * `export-surface.txt` 由 `bun run scripts/entry-export-surface.ts` 生成,是允许导出的唯一真相源,
 * 需要增删导出时必须显式重新生成它并在评审中说明——这是刻意的两步操作。
 *
 * 本测试只覆盖运行时存在的值导出;类型导出不存在于运行时,由同目录快照与脚本 diff 看守
 * (快照的 `type` 行无法在运行时断言)。
 */
function snapshotValueExports(): string[] {
    const surface = readFileSync(new URL("../entry-surface.txt", import.meta.url), "utf8");
    return surface
        .split("\n")
        .filter((line) => line.startsWith("value\t"))
        .map((line) => line.slice("value\t".length))
        .sort();
}

describe("application package entry contract", () => {
    it("运行时值导出与冻结的导出面一致", () => {
        expect(Object.keys(entry).sort()).toEqual(snapshotValueExports());
    });
});
