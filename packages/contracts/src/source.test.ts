import { describe, expect, it } from "vitest";

import {
    aiHotSourceConfigSchema,
    bilibiliSourceConfigSchema,
    getSourceConfigurationSchema,
    publisherSchema,
    rssSourceConfigSchema,
    mediaPolicyCeilings,
    mediaRetryCeiling,
    sourceConfigSchema,
    sourceMediaPolicySchema,
    connectionProbeJobPayloadSchema,
    connectionProbeJobSnapshotSchema,
    connectionProbeResultSchema,
    createSourceCommandSchema,
    jobKindSchema,
    jobSnapshotSchema,
    sourceConfigProbeCommandSchema,
    sourceConfigProbeJobPayloadSchema,
    sourceConfigProbeJobSnapshotSchema,
    sourceConfigProbeResultSchema,
    sourceDefinitionManifestSchema,
    sourceDefinitionPageSchema,
    sourceExecutionSnapshotSchema,
    sourceProbeResultSchema,
    temporalValueSchema,
    updateSourceCommandSchema,
} from "./index.js";

describe("source and job contracts", () => {
    it("accepts only the supported Bilibili source modes", () => {
        expect(bilibiliSourceConfigSchema.parse({
            mode: "hot",
            limit: 5,
        })).toMatchObject({
            mode: "hot",
            limit: 5,
        });

        // `feed` 不再要求配置里有 profile：profile 归连接（Proposal
        // connection-login-lifecycle-v1 决定 1），本用例只守 mode 的取值域。
        expect(bilibiliSourceConfigSchema.parse({
            mode: "feed",
            limit: 5,
        })).toMatchObject({ mode: "feed" });

        expect(() => bilibiliSourceConfigSchema.parse({
            mode: "search",
        })).toThrow();

        expect(() => bilibiliSourceConfigSchema.parse({
            mode: "hot",
            command: ["bilibili", "hot"],
        })).toThrow();
    });

    it("restricts RSS feedUrl to http(s) URLs", () => {
        expect(rssSourceConfigSchema.parse({
            feedUrl: "https://example.test/feed.xml",
        })).toMatchObject({ feedUrl: "https://example.test/feed.xml" });
        expect(() => rssSourceConfigSchema.parse({
            feedUrl: "file:///etc/passwd",
        })).toThrow();
        expect(() => rssSourceConfigSchema.parse({
            feedUrl: "ftp://example.test/feed.xml",
        })).toThrow();
    });

    it("resolves canonical configuration schemas by source definition ref", () => {
        expect(getSourceConfigurationSchema("source.rss@1")).toBe(rssSourceConfigSchema);
        expect(getSourceConfigurationSchema("source.bilibili@1")).toBe(bilibiliSourceConfigSchema);
        expect(getSourceConfigurationSchema("source.unknown@1")).toBeNull();
    });

    it("keeps the media budget out of the source config", () => {
        // 媒体预算归采集计划（ADR-0023 决策 2）：目标配置里不再有 media 字段，
        // 来源端点写不进它，读取方是计划。RSS 的配置是 strict，多带 media 必须被拒。
        expect(rssSourceConfigSchema.parse({
            feedUrl: "https://example.test/feed.xml",
        })).toEqual({ feedUrl: "https://example.test/feed.xml" });
        expect(() => rssSourceConfigSchema.parse({
            feedUrl: "https://example.test/feed.xml",
            media: { images: "metadata_only" },
        })).toThrow();
        expect(sourceMediaPolicySchema.parse({
            images: "metadata_only",
            maxFileBytes: 2 * 1024 * 1024,
        })).toEqual({
            images: "metadata_only",
            maxFileBytes: 2 * 1024 * 1024,
        });
    });

    it("rejects media policy values above the global ceilings or outside the enum", () => {
        expect(() => sourceMediaPolicySchema.parse({
            maxFileBytes: mediaPolicyCeilings.maxFileBytes + 1,
        })).toThrow();
        expect(() => sourceMediaPolicySchema.parse({
            maxRunBytes: mediaPolicyCeilings.maxRunBytes + 1,
        })).toThrow();
        expect(() => sourceMediaPolicySchema.parse({ maxFileBytes: 1024 })).toThrow();
        expect(() => sourceMediaPolicySchema.parse({ images: "keep" })).toThrow();
        expect(() => sourceMediaPolicySchema.parse({ downloadAudio: true })).toThrow();
        expect(mediaPolicyCeilings).toEqual({
            maxFileBytes: 10 * 1024 * 1024,
            maxRunBytes: 50 * 1024 * 1024,
        });
    });

    it("accepts the per-source retry and retention policy within its bounds", () => {
        expect(sourceMediaPolicySchema.parse({
            retry: { maxAttempts: 0 },
            retentionDays: 30,
        })).toEqual({ retry: { maxAttempts: 0 }, retentionDays: 30 });
        expect(sourceMediaPolicySchema.parse({ retry: {} })).toEqual({ retry: {} });
        expect(() => sourceMediaPolicySchema.parse({
            retry: { maxAttempts: mediaRetryCeiling + 1 },
        })).toThrow();
        expect(() => sourceMediaPolicySchema.parse({ retry: { maxAttempts: -1 } })).toThrow();
        expect(() => sourceMediaPolicySchema.parse({ retry: { backoffMs: 1 } })).toThrow();
        expect(() => sourceMediaPolicySchema.parse({ retentionDays: 3651 })).toThrow();
        expect(() => sourceMediaPolicySchema.parse({ retentionDays: -1 })).toThrow();
    });

    it("validates the public AI HOT configuration", () => {
        expect(aiHotSourceConfigSchema.parse({})).toMatchObject({
            schemaVersion: 1,
        });
        expect(() => aiHotSourceConfigSchema.parse({
            endpoint: "https://example.test",
        })).toThrow();
    });

    it("requires a versioned source definition while keeping connector validation separate", () => {
        expect(createSourceCommandSchema.parse({
            name: "Bilibili hot",
            sourceDefinitionRef: "source.bilibili@1",
            operationId: "fetch",
            config: {
                mode: "hot",
                limit: 10,
            },
        }).sourceDefinitionRef).toBe("source.bilibili@1");
    });

    it("requires a versioned source definition and saves new sources disabled", () => {
        const command = createSourceCommandSchema.parse({
            name: "RSS source",
            sourceDefinitionRef: "source.rss@1",
            operationId: "fetch",
            config: { feedUrl: "https://example.test/feed.xml" },
        });

        expect(command).toMatchObject({
            sourceDefinitionRef: "source.rss@1",
            operationId: "fetch",
        });
        expect(command).not.toHaveProperty("enabled");
        expect(() => createSourceCommandSchema.parse({
            ...command,
            enabled: true,
        })).toThrow();
    });

    it("requires a revision guard for complete source replacement", () => {
        expect(updateSourceCommandSchema.parse({
            baseRevisionId: "source-1:2",
            name: "Renamed RSS",
            config: { feedUrl: "https://example.test/new-feed.xml" },
        })).toMatchObject({
            baseRevisionId: "source-1:2",
            config: { feedUrl: "https://example.test/new-feed.xml" },
        });
        expect(() => updateSourceCommandSchema.parse({
            enabled: true,
        })).toThrow();
    });

    it("exposes a revision id in immutable source execution snapshots", () => {
        const snapshot = sourceExecutionSnapshotSchema.parse({
            id: "source-1",
            name: "RSS source",
            kind: "rss",
            sourceDefinitionRef: "source.rss@1",
            operationId: "fetch",
            connectorId: "rss",
            config: { feedUrl: "https://example.test/feed.xml" },
            enabled: false,
            planId: "plan:source-1",
            mediaPolicy: null,
            revisionId: "source-1:1",
            createdAt: "2026-08-24T00:00:00.000Z",
            updatedAt: "2026-08-24T00:00:00.000Z",
        });

        expect(snapshot.revisionId).toBe("source-1:1");
        // 计划身份进执行快照（ADR-0023 决策 2）：checkpoint 与连接器状态命名空间都在
        // workflow 内部解析，那里拿不到 envelope。
        expect(snapshot.planId).toBe("plan:source-1");
        // 媒体预算入队固化（ADR-0014 决策 4）：缺省是 null（跟随全局默认），不是可选。
        expect(snapshot.mediaPolicy).toBeNull();
    });

    /**
     * 连接投影随入队冻结（Proposal connection-login-lifecycle-v1 决定 1；AUT-016 明确
     * 写「排队后修改 Connection 配置不会改变已创建 Run 的输入」）。只冻身份与非秘密
     * 配置，`status`/`lastError` 这类活诊断不得进入——它们冻下来之后只会误导。
     */
    it("freezes the connection projection into the execution snapshot", () => {
        const base = {
            id: "source-1",
            name: "Bilibili feed",
            kind: "bilibili",
            sourceDefinitionRef: "source.bilibili@1",
            operationId: "fetch",
            connectorId: "bilibili",
            config: { mode: "feed", limit: 20 },
            enabled: true,
            planId: "plan:source-1",
            mediaPolicy: null,
            revisionId: "source-1:1",
            createdAt: "2026-08-24T00:00:00.000Z",
            updatedAt: "2026-08-24T00:00:00.000Z",
        };
        const connection = {
            id: "connection-1",
            connectorId: "bilibili",
            configJson: '{"profile":"chrome-main"}',
        };

        expect(sourceExecutionSnapshotSchema.parse({ ...base, connection }).connection).toEqual(connection);
        // 未保存配置的探测路径没有连接：缺省与显式 null 都必须可解析。
        expect(sourceExecutionSnapshotSchema.parse({ ...base }).connection).toBeUndefined();
        expect(sourceExecutionSnapshotSchema.parse({ ...base, connection: null }).connection).toBeNull();
        expect(() => sourceExecutionSnapshotSchema.parse({
            ...base,
            connection: { ...connection, status: "active" },
        })).toThrow();
    });

    /**
     * profile 归连接之后，来源配置里再出现它就是错的：迁移必须把它搬走，而不是让
     * 一份配置同时有两个所有者（ADR-0017 决策 1 由此被本片部分取代）。
     */
    it("no longer accepts the OpenCLI profile inside the Bilibili source config", () => {
        expect(bilibiliSourceConfigSchema.parse({ mode: "feed", limit: 5 })).toMatchObject({
            mode: "feed",
            limit: 5,
        });
        expect(() => bilibiliSourceConfigSchema.parse({ mode: "feed", profile: "chrome-main" })).toThrow();
    });

    it("validates probe results and job snapshots", () => {
        expect(sourceProbeResultSchema.parse({
            sourceId: "source-1",
            connectorId: "bilibili",
            itemCount: 3,
            nextCursorAvailable: false,
            checkedAt: "2026-08-08T00:00:00.000Z",
        }).itemCount).toBe(3);

        expect(jobSnapshotSchema.parse({
            id: "job-1",
            kind: "source-probe",
            sourceId: "source-1",
            runId: null,
            status: "queued",
            attempts: 0,
            maxAttempts: 3,
            errorCode: null,
            error: null,
            createdAt: "2026-08-08T00:00:00.000Z",
            updatedAt: "2026-08-08T00:00:00.000Z",
            result: null,
        }).kind).toBe("source-probe");
    });

    it("accepts author records without a platform id and normalizes blanks to null", () => {
        expect(publisherSchema.parse({
            platformId: "  ",
            name: "RSS author",
            handle: "",
            profileUrl: null,
            kind: "unknown",
        })).toMatchObject({
            platformId: null,
            name: "RSS author",
            handle: null,
            kind: "unknown",
        });
    });

    it("requires a temporal value to retain exact or fallback evidence", () => {
        expect(() => temporalValueSchema.parse({
            exact: null,
            exactPrecision: null,
            fallback: null,
        })).toThrow();
    });
});

describe("source config probe contracts", () => {
    const probeCommand = {
        sourceDefinitionRef: "source.rss@1",
        operationId: "fetch",
        config: { feedUrl: "https://example.test/feed.xml" },
    } as const;

    it("parses a config probe command and rejects unknown fields", () => {
        expect(sourceConfigProbeCommandSchema.parse(probeCommand)).toEqual(probeCommand);
        expect(() => sourceConfigProbeCommandSchema.parse({
            ...probeCommand,
            sourceId: "source-1",
        })).toThrow();
        expect(() => sourceConfigProbeCommandSchema.parse({
            ...probeCommand,
            sourceDefinitionRef: "source.rss@latest",
        })).toThrow();
    });

    it("parses the job payload wrapper strictly", () => {
        expect(sourceConfigProbeJobPayloadSchema.parse({ configProbe: probeCommand })).toMatchObject({
            configProbe: probeCommand,
        });
        expect(() => sourceConfigProbeJobPayloadSchema.parse({ sourceId: "source-1" })).toThrow();
    });

    it("caps probe results at three sample titles of 200 characters", () => {
        const base = {
            sourceDefinitionRef: "source.rss@1",
            operationId: "fetch",
            connectorId: "rss",
            itemCount: 2,
            nextCursorAvailable: false,
            checkedAt: "2026-08-24T00:00:00.000Z",
            durationMs: 120,
        };
        expect(sourceConfigProbeResultSchema.parse({
            ...base,
            sampleTitles: ["First", "Second"],
        })).toMatchObject({ sampleTitles: ["First", "Second"] });

        expect(() => sourceConfigProbeResultSchema.parse({
            ...base,
            sampleTitles: ["1", "2", "3", "4"],
        })).toThrow();
        expect(() => sourceConfigProbeResultSchema.parse({
            ...base,
            sampleTitles: ["x".repeat(201)],
        })).toThrow();
    });

    it("pins the config probe job snapshot kind and result shape", () => {
        const job = {
            id: "job-1",
            kind: "source-config-probe",
            sourceId: null,
            runId: null,
            status: "queued",
            attempts: 0,
            maxAttempts: 3,
            errorCode: null,
            error: null,
            createdAt: "2026-08-24T00:00:00.000Z",
            updatedAt: "2026-08-24T00:00:00.000Z",
            result: null,
        };
        expect(sourceConfigProbeJobSnapshotSchema.parse(job)).toMatchObject({ kind: "source-config-probe" });
        expect(() => sourceConfigProbeJobSnapshotSchema.parse({ ...job, kind: "source-probe" })).toThrow();
        expect(() => sourceConfigProbeJobSnapshotSchema.parse({
            ...job,
            status: "succeeded",
            result: { itemCount: 1 },
        })).toThrow();
        expect(jobSnapshotSchema.parse(job)).toMatchObject({ kind: "source-config-probe" });
    });
});

describe("source definition catalog contracts", () => {
    const rssManifest = {
        id: "rss",
        version: 1,
        ref: "source.rss@1",
        provider: "cosmos",
        connectorId: "rss",
        displayName: "RSS",
        description: "Fetch one RSS or Atom feed page.",
        manifestHash: { algorithm: "builtin", value: "builtin:source.rss@1" },
        status: "enabled",
        operationIds: ["fetch"],
        capabilities: ["source:read", "cursor"],
        configurationSchema: {
            id: "source.rss.config@1",
            version: 1,
            hash: { algorithm: "builtin", value: "source.rss.config@1" },
            schema: {
                type: "object",
                properties: { feedUrl: { type: "string", format: "uri" } },
                required: ["feedUrl"],
            },
        },
        auth: { kind: "none", label: null, secretRefRequired: false, probeSupported: false },
        operations: [{
            operationId: "fetch",
            inputSchema: { id: "source.rss.fetch.input@1", version: 1, hash: { algorithm: "builtin", value: "i" } },
            outputSchema: { id: "source.rss.fetch.output@1", version: 1, hash: { algorithm: "builtin", value: "o" } },
            externalKey: "url",
            discoveryContext: "",
            media: "download",
            stateStoreNamespace: "{id}",
        }],
    } as const;

    it("parses a source definition manifest with a descriptive configuration schema", () => {
        const manifest = sourceDefinitionManifestSchema.parse(rssManifest);
        expect(manifest).toMatchObject({
            ref: "source.rss@1",
            connectorId: "rss",
            status: "enabled",
        });
        expect(manifest.configurationSchema.schema).toMatchObject({ type: "object" });
    });

    it("rejects manifests with an unversioned ref or unknown fields", () => {
        expect(() => sourceDefinitionManifestSchema.parse({
            ...rssManifest,
            ref: "source.rss@latest",
        })).toThrow();
        expect(() => sourceDefinitionManifestSchema.parse({
            ...rssManifest,
            scheduleIntervalMs: 1_800_000,
        })).toThrow();
    });

    it("parses the catalog page envelope with items and snapshot metadata", () => {
        const page = sourceDefinitionPageSchema.parse({
            items: [rssManifest],
            nextCursor: null,
            snapshotAt: "2026-09-02T00:00:00.000Z",
        });
        expect(page.items).toHaveLength(1);
        expect(page.snapshotAt).toBe("2026-09-02T00:00:00.000Z");
        expect(() => sourceDefinitionPageSchema.parse({
            items: [rssManifest],
        })).toThrow();
    });

    /**
     * 连接登录探测（Proposal connection-login-lifecycle-v1 决定 2）：探测能不能发起由
     * manifest 的 `auth.probeSupported` 声明，Job 载荷只带连接标识，结果带三种结论。
     */
    it("declares whether an adapter supports login probing", () => {
        expect(sourceDefinitionManifestSchema.parse(rssManifest).auth.probeSupported).toBe(false);
        expect(() => sourceDefinitionManifestSchema.parse({
            ...rssManifest,
            auth: { kind: "none", label: null, secretRefRequired: false },
        })).toThrow();
    });

    it("round-trips a connection probe job payload and snapshot", () => {
        expect(connectionProbeJobPayloadSchema.parse({ connectionId: "connection-1" }))
            .toEqual({ connectionId: "connection-1" });
        expect(() => connectionProbeJobPayloadSchema.parse({ connectionId: "" })).toThrow();
        expect(() => connectionProbeJobPayloadSchema.parse({
            connectionId: "connection-1",
            sourceId: "source-1",
        })).toThrow();

        const job = connectionProbeJobSnapshotSchema.parse({
            id: "job-1",
            kind: "connection-probe",
            sourceId: null,
            runId: null,
            status: "succeeded",
            attempts: 1,
            maxAttempts: 3,
            errorCode: null,
            error: null,
            createdAt: "2026-09-23T00:00:00.000Z",
            updatedAt: "2026-09-23T00:00:00.000Z",
            result: {
                connectionId: "connection-1",
                outcome: "expired",
                account: null,
                reason: "需要重新登录 Bilibili（浏览器里的登录态已失效）。",
                checkedAt: "2026-09-23T00:00:00.000Z",
            },
        });
        expect(job.result?.outcome).toBe("expired");
        expect(jobKindSchema.parse("connection-probe")).toBe("connection-probe");
        expect(() => connectionProbeJobSnapshotSchema.parse({ ...job, kind: "source-probe" })).toThrow();
        expect(() => connectionProbeResultSchema.parse({
            connectionId: "connection-1",
            outcome: "unknown",
            account: null,
            reason: null,
            checkedAt: "2026-09-23T00:00:00.000Z",
        })).toThrow();
    });
});
