import {
    describe,
    expect,
    it,
} from "vitest";

import { createWriteVersion } from "./list-write-guard";

/**
 * 这些规则钉的是实测过的产品缺陷：一次读取可能在用户创建标签之前抓到空列表、
 * 却在创建之后落地，把标签从界面覆盖掉（标签随之无法再挂到别的 Story）；
 * 以及先发起的读取晚落地，把刚建的实体／Topic 从侧栏抹掉。
 */
describe("列表状态的写入闸门", () => {
    it("丢弃本地写入之前发起的读取快照", () => {
        const guard = createWriteVersion();
        const applied: string[][] = [];
        const apply = (next: string[]): void => {
            applied.push(next);
        };

        // 读取发起，取到票据。
        const read = guard.beginRead();
        // 用户创建标签：本地写入推进版本，并写下新值。
        guard.markLocalWrite();
        apply(["阶段2验收"]);

        // 读取带着"创建之前"抓到的空列表落地——必须被丢弃。
        if (guard.acceptsRead(read)) {
            apply([]);
        }

        expect(applied).toEqual([["阶段2验收"]]);
    });

    it("没有本地写入时照常接受读取结果", () => {
        const guard = createWriteVersion();
        const read = guard.beginRead();

        expect(guard.acceptsRead(read)).toBe(true);
    });

    it("读取之间不互相作废", () => {
        const guard = createWriteVersion();
        const applied: string[][] = [];

        // 连续两次读取：第一次写入后，第二次的快照不能被第一次的写入作废，
        // 否则列表会永久停在第一次的结果上。
        const first = guard.beginRead();
        if (guard.acceptsRead(first)) {
            applied.push(["a"]);
        }
        const second = guard.beginRead();
        if (guard.acceptsRead(second)) {
            applied.push(["a", "b"]);
        }

        expect(applied).toEqual([["a"], ["a", "b"]]);
    });

    it("本地写入只作废它之前取到的票据", () => {
        const guard = createWriteVersion();
        guard.markLocalWrite();
        // 本地写入**之后**才发起的读取，带的是新版本，应当被接受。
        const afterWrite = guard.beginRead();

        expect(guard.acceptsRead(afterWrite)).toBe(true);
    });

    it("丢弃更晚发起、却更早落地的旧读取快照", () => {
        const guard = createWriteVersion();
        const applied: string[][] = [];

        // 两个读取同时在飞：A 先发起、B 后发起。B 先落地，写下含新实体的列表；
        // A 随后落地，它抓的是"还没有这个实体"的快照，必须被丢弃。
        const readA = guard.beginRead();
        const readB = guard.beginRead();
        if (guard.acceptsRead(readB)) {
            applied.push(["验收实体"]);
        }
        if (guard.acceptsRead(readA)) {
            applied.push([]);
        }

        expect(applied).toEqual([["验收实体"]]);
    });

    it("最新一次读取落地后，更早的读取票据永久失效", () => {
        const guard = createWriteVersion();
        const stale = guard.beginRead();
        guard.beginRead();

        expect(guard.acceptsRead(stale)).toBe(false);
    });
});
