import { describe, expect, it } from "vitest";

import * as entry from "./index.js";

// 公共入口的值导出集合在治理拆分(G02)期间冻结：零增减、零改名。
// 任何变更都会破坏消费方 import,须显式更新本清单并向维护者说明理由
// (docs/proposals/code-size-governance-v1.md:导出签名 diff 为零)。
const FROZEN_VALUE_EXPORTS = [
    "FileSecretStore",
    "PrismaConnectorStateStore",
    "PrismaCosmosRepository",
    "PrismaWorkflowBackend",
    "PrismaWorkflowEventSink",
    "PrismaWorkflowHostStore",
    "createPrismaClient",
    "resolveContainedPath",
    "resolveStorageRoots",
];

describe("storage-prisma 公共入口契约", () => {
    it("值导出集合与冻结清单零 diff", () => {
        expect(Object.keys(entry).sort()).toEqual(FROZEN_VALUE_EXPORTS);
    });
});
