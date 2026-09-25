import {
    describe,
    expect,
    it,
} from "vitest";

import { createWriteVersion } from "./list-write-guard";

/**
 * 这些规则钉的是实测过的产品缺陷：一次刷新可能在用户创建标签之前抓到空列表、
 * 却在创建之后落地，把标签从界面覆盖掉（标签随之无法再挂到别的 Story）。
 */
describe("用户可变列表的写入版本", () => {
    it("丢弃本地写入之前发起的刷新快照", () => {
        const guard = createWriteVersion();
        const applied: string[][] = [];
        const apply = (next: string[]): void => {
            applied.push(next);
        };

        // 刷新发起，取到版本。
        const captured = guard.current();
        // 用户创建标签：本地写入推进版本，并写下新值。
        guard.markLocalWrite();
        apply(["阶段2验收"]);

        // 刷新带着"创建之前"抓到的空列表落地——必须被丢弃。
        if (guard.acceptsRefresh(captured)) {
            apply([]);
        }

        expect(applied).toEqual([["阶段2验收"]]);
    });

    it("没有本地写入时照常接受刷新结果", () => {
        const guard = createWriteVersion();
        const captured = guard.current();

        expect(guard.acceptsRefresh(captured)).toBe(true);
    });

    it("刷新之间不互相作废", () => {
        const guard = createWriteVersion();
        const applied: string[][] = [];

        // 连续两次刷新：第一次写入后，第二次的快照不能被第一次的写入作废，
        // 否则列表会永久停在第一次的结果上。
        const first = guard.current();
        if (guard.acceptsRefresh(first)) {
            applied.push(["a"]);
        }
        const second = guard.current();
        if (guard.acceptsRefresh(second)) {
            applied.push(["a", "b"]);
        }

        expect(applied).toEqual([["a"], ["a", "b"]]);
    });

    it("本地写入只作废它之前取到的版本", () => {
        const guard = createWriteVersion();
        guard.markLocalWrite();
        // 本地写入**之后**才发起的刷新，带的是新版本，应当被接受。
        const afterWrite = guard.current();

        expect(guard.acceptsRefresh(afterWrite)).toBe(true);
    });
});
