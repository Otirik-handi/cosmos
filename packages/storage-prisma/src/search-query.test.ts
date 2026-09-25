import { IngestionService, type IngestConnector } from "@cosmos/application";
import type { NormalizedIngestItem } from "@cosmos/domain";
import { describe, expect, it } from "vitest";

import { PrismaCosmosRepository } from "./index.js";
import { createFixtureSource, withRepository } from "./index.fixtures.js";

/**
 * 搜索把用户输入交给 SQLite FTS5 的 `MATCH`。输入不是 FTS5 查询语言，而是普通
 * 关键词，所以本文件固定的是「字面文本」语义：语法字符（`-`、`"`、`*`、括号）
 * 一律当普通字符，多词仍是 AND。
 */
describe("Search text handling", () => {
    it("treats FTS5 syntax characters as literal text instead of failing", async () => {
        await withRepository("search-query", async (repository) => {
            await setup(repository);
            // 未修复前：`-` 被 FTS5 当作 NOT 运算符，语句语法错误让整个请求 500。
            const unmatched = await repository.search({ text: "绝不匹配-212c82", limit: 20 });
            expect(unmatched.items).toEqual([]);

            // 带连字符的词是正常内容，必须能被搜到。
            const hyphenated = await repository.search({ text: "state-of-the-art", limit: 20 });
            expect(hyphenated.items.map((item) => item.title)).toEqual([
                "State-of-the-art retrieval",
            ]);

            const quoted = await repository.search({ text: "\"retrieval\"", limit: 20 });
            expect(quoted.items.map((item) => item.title)).toEqual(["State-of-the-art retrieval"]);

            const parenthesised = await repository.search({ text: "(scaffold)", limit: 20 });
            expect(parenthesised.items.map((item) => item.title)).toEqual(["Cosmos scaffold is ready"]);
        });
    });

    it("does not interpret FTS5 operators", async () => {
        await withRepository("search-query", async (repository) => {
            await setup(repository);
            // 多词仍是 AND：两个词都在同一篇里才命中。
            const both = await repository.search({ text: "cosmos scaffold", limit: 20 });
            expect(both.items.map((item) => item.title)).toEqual(["Cosmos scaffold is ready"]);
            const oneMissing = await repository.search({ text: "cosmos missing", limit: 20 });
            expect(oneMissing.items).toEqual([]);

            // `OR` 是普通词而不是运算符：没有条目同时包含 cosmos / or / scaffold，故无结果。
            const orKeyword = await repository.search({ text: "cosmos OR scaffold", limit: 20 });
            expect(orKeyword.items).toEqual([]);

            // `*` 不是前缀通配，只是被分词器忽略的字符。
            const star = await repository.search({ text: "cosmos*", limit: 20 });
            expect(star.items.map((item) => item.title)).toEqual(["Cosmos scaffold is ready"]);
        });
    });

    it("falls back to no text filter when the input carries no searchable token", async () => {
        await withRepository("search-query", async (repository) => {
            await setup(repository);
            for (const text of ["", "   ", "-", "***", "()"]) {
                const result = await repository.search({ text, limit: 20 });
                expect(result.items).toHaveLength(2);
                // 无文本条件时按 Entry updatedAt 倒序，不走 FTS 排序。
                expect(result.items.every((item) => item.rank === 0)).toBe(true);
            }
        });
    });
});

async function setup(repository: PrismaCosmosRepository): Promise<void> {
    const source = await createFixtureSource(repository, { name: "Search fixture", config: {} });
    const items = [
        fixtureItem("hyphen", "State-of-the-art retrieval", "A body about state-of-the-art retrieval."),
        fixtureItem("plain", "Cosmos scaffold is ready", "The Cosmos scaffold ships with a feed."),
    ];
    const connector: IngestConnector = {
        id: "search-fixture",
        description: "Search fixture",
        configVersion: "v1",
        capabilities: ["test"],
        validate: () => undefined,
        async fetchItems() {
            return { items, nextCursor: null };
        },
    };
    await new IngestionService(repository, () => connector).runSource(source.id);
}

function fixtureItem(externalId: string, title: string, contentText: string): NormalizedIngestItem {
    return {
        externalId,
        title,
        summary: null,
        contentText,
        webUrl: null,
        kind: "article",
        publisher: null,
        metrics: null,
        publishedAt: null,
        updatedAt: null,
        sourceLocator: { provider: "fixture", item: externalId },
        rawPayload: `<item>${externalId}</item>`,
        assets: [],
    };
}
