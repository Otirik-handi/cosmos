import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { IngestionService, type IngestConnector } from "@cosmos/application";
import type { NormalizedIngestItem } from "@cosmos/domain";
import { PrismaCosmosRepository } from "./index.js";
import { createFixtureSource, prepareDatabase, temporaryRoots } from "./index.fixtures.js";

/**
 * ING-004：Observation 要记录「内容为什么被发现」。渠道由连接器在域层声明，
 * 仓储写进 `discoveryContextJson`，读投影再取回来；旧数据（没有该字段）降级为 unknown。
 */
async function ingestOne(repository: PrismaCosmosRepository, item: NormalizedIngestItem): Promise<string> {
    const source = await createFixtureSource(repository, { name: "Discovery fixture", config: {} });
    const connector: IngestConnector = {
        id: "test-fixture",
        description: "Test fixture",
        configVersion: "v1",
        capabilities: ["test"],
        validate: () => undefined,
        async fetchItems() {
            return { items: [item], nextCursor: null };
        },
    };
    await new IngestionService(repository, () => connector).runSource(source.id);
    const entries = await repository.entries({ limit: 10 });
    return entries.items[0]!.id;
}

function baseItem(overrides: Partial<NormalizedIngestItem> = {}): NormalizedIngestItem {
    return {
        externalId: "discovery-1",
        title: "发现渠道用例",
        summary: null,
        contentText: "正文",
        webUrl: null,
        kind: "article",
        publisher: null,
        metrics: null,
        publishedAt: null,
        updatedAt: null,
        sourceLocator: { provider: "fixture", item: "discovery-1" },
        rawPayload: "<item>discovery-1</item>",
        assets: [],
        ...overrides,
    };
}

it("persists the connector-declared discovery channel on the Observation (ING-004)", async () => {
    const root = await mkdtemp(join(tmpdir(), "cosmos-discovery-"));
    temporaryRoots.push(root);
    prepareDatabase(root);

    const repository = new PrismaCosmosRepository({ dataRoot: root });
    await repository.initialize();

    try {
        const entryId = await ingestOne(repository, baseItem({ discoveryChannel: "recommendation" }));

        const detail = await repository.entry(entryId);
        expect(detail?.observations[0]?.discoveryChannel).toBe("recommendation");

        // 旧数据：升级前写入的 Observation 没有 channel，读取侧降级为 unknown 而不是抛错。
        await repository.prisma.observation.updateMany({
            data: { discoveryContextJson: JSON.stringify({ kind: "manual" }) },
        });
        const legacy = await repository.entry(entryId);
        expect(legacy?.observations[0]?.discoveryChannel).toBe("unknown");
    } finally {
        await repository.close();
    }
});

it("records unknown when the connector declares no channel", async () => {
    const root = await mkdtemp(join(tmpdir(), "cosmos-discovery-none-"));
    temporaryRoots.push(root);
    prepareDatabase(root);

    const repository = new PrismaCosmosRepository({ dataRoot: root });
    await repository.initialize();

    try {
        const entryId = await ingestOne(repository, baseItem({ externalId: "discovery-2" }));

        const detail = await repository.entry(entryId);
        expect(detail?.observations[0]?.discoveryChannel).toBe("unknown");
    } finally {
        await repository.close();
    }
});
