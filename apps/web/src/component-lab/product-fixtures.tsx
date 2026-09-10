import {useMemo} from "react";
import {zodResolver} from "@hookform/resolvers/zod";
import {useForm} from "react-hook-form";

import type {
    BoardBlock,
    BoardDetail,
    EntityDetail,
    EntitySummary,
    EntryDetail,
    FeedItem,
    HealthResponse,
    RunControlResult,
    RunSnapshot,
    SourceConfigProbeResult,
    SourceDefinitionManifest,
    SourceSnapshot,
    StoryDetail,
    StorySubtype,
    TopicDetail,
} from "@cosmos/contracts";
import { HttpCosmosClient } from "@cosmos/transport-http";

import { BoardView } from "@/components/cosmos/board-view";
import {FeedBrowser, searchSchema, type SearchFormValues} from "@/components/cosmos/feed-browser";
import {RunControl} from "@/components/cosmos/run-control";
import {RunHistory} from "@/components/cosmos/run-history";
import {SourceActions} from "@/components/cosmos/source-actions";
import {
    SourceForm,
    sourceFormSchema,
    type ProbeState,
    type SourceDefinitionState,
    type SourceFormValues,
} from "@/components/cosmos/source-form";
import {
    StatusSummary,
    type EventStreamState,
} from "@/components/cosmos/status-summary";
import {StoryPanel} from "@/components/cosmos/story-panel";
import {TopicPanel} from "@/components/cosmos/topic-panel";
import {EntityPanel} from "@/components/cosmos/entity-panel";
import {ThemeSwitcher} from "@/components/cosmos/theme-switcher";

import type {CosmosThemePreference} from "@/theme/theme";

import type {LabProps} from "./types";

const fixtureTimestamp = "2026-01-01T00:00:00.000Z";

/** 与 domain 注册表同构的合成目录；实验室不发任何 Product API 请求。 */
const labStorySubtypeOptions: readonly StorySubtype[] = [
    {
        id: "media.comic",
        kind: "media",
        version: 1,
        label: "漫画",
        description: "同一部漫画作品。",
        status: "active",
        identityPolicy: "same-work-v1",
        owner: "core",
    },
    {
        id: "media.anime",
        kind: "media",
        version: 1,
        label: "动画",
        description: "同一部动画作品。",
        status: "active",
        identityPolicy: "same-work-v1",
        owner: "core",
    },
    {
        id: "media.video",
        kind: "media",
        version: 1,
        label: "视频",
        description: "同一段视频或影像作品。",
        status: "active",
        identityPolicy: "same-work-v1",
        owner: "core",
    },
];

function textProp(props: LabProps, name: string, fallback: string): string {
    const value = props[name];
    return typeof value === "string" ? value : fallback;
}

function optionProp<T extends string>(props: LabProps, name: string, fallback: T, options: readonly T[]): T {
    const value = props[name];
    return typeof value === "string" && options.includes(value as T) ? value as T : fallback;
}

function booleanProp(props: LabProps, name: string, fallback = false): boolean {
    const value = props[name];
    return typeof value === "boolean" ? value : fallback;
}

/** 合成 manifest：与产品 `source.rss@1` 的 configurationSchema 同构，但无任何网络请求。 */
const labSourceDefinitionManifest: SourceDefinitionManifest = {
    id: "rss",
    version: 1,
    ref: "source.rss@1",
    provider: "cosmos",
    connectorId: "rss",
    displayName: "RSS",
    description: "Fetch one RSS or Atom feed page.",
    manifestHash: {algorithm: "builtin", value: "builtin:source.rss@1"},
    status: "enabled",
    operationIds: ["fetch"],
    capabilities: ["source:read", "cursor"],
    configurationSchema: {
        id: "source.rss.config@1",
        version: 1,
        hash: {algorithm: "builtin", value: "source.rss.config@1"},
        schema: {
            type: "object",
            properties: {
                feedUrl: {type: "string", format: "uri"},
                scheduleIntervalMs: {type: "integer", minimum: 1000, maximum: 2678400000},
            },
            required: ["feedUrl"],
            additionalProperties: false,
        },
    },
};

const labProbeResult: SourceConfigProbeResult = {
    sourceDefinitionRef: "source.rss@1",
    operationId: "fetch",
    connectorId: "rss",
    itemCount: 3,
    nextCursorAvailable: false,
    sampleTitles: ["Cosmos scaffold is ready", "Second fixture item", "第三条样例标题"],
    checkedAt: fixtureTimestamp,
    durationMs: 140,
};

export function renderSourceFormLab(props: LabProps) {
    return <SourceFormLabFixture props={props} />;
}

function SourceFormLabFixture({props}: {props: LabProps}) {
    const name = textProp(props, "name", "Cosmos RSS");
    const feedUrl = textProp(props, "feedUrl", "https://example.com/feed.xml");
    const definitionState = optionProp<SourceDefinitionState["status"]>(
        props,
        "definitionState",
        "ready",
        ["ready", "loading", "error"] as const,
    );
    const probeState = optionProp<ProbeState["status"]>(
        props,
        "probeState",
        "idle",
        ["idle", "running", "succeeded", "failed", "timeout"] as const,
    );
    const values = useMemo<SourceFormValues>(
        () => ({name, feedUrl, scheduleIntervalMinutes: "30"}),
        [feedUrl, name],
    );
    const form = useForm<SourceFormValues>({
        resolver: zodResolver(sourceFormSchema),
        defaultValues: values,
        values,
    });
    const resolvedDefinitionState: SourceDefinitionState = definitionState === "ready"
        ? {status: "ready", manifest: labSourceDefinitionManifest}
        : definitionState === "error"
        ? {status: "error", message: "无法连接服务（HTTP 503）。"}
        : {status: "loading"};
    const resolvedProbeState: ProbeState = probeState === "succeeded"
        ? {status: "succeeded", result: labProbeResult}
        : probeState === "failed"
        ? {status: "failed", message: "Feed 返回 404。"}
        : {status: probeState};
    return (
        <SourceForm
            form={form}
            definitionState={resolvedDefinitionState}
            onSubmit={(event) => event.preventDefault()}
            onTest={() => undefined}
            probeState={resolvedProbeState}
            onRetryDefinition={() => undefined}
        />
    );
}

export function renderStatusSummaryLab(props: LabProps) {
    const healthState = optionProp(props, "health", "unknown", ["unknown", "ready", "failed"] as const);
    const eventStreamState = optionProp(
        props,
        "eventStreamState",
        "connecting",
        ["connecting", "connected", "unavailable"] as const,
    );
    const health: HealthResponse | null = healthState === "unknown"
        ? null
        : {
            status: "ok",
            service: "Cosmos fixture",
            version: "0.1.0",
            protocolVersion: "v1",
            workerStatus: healthState === "ready" ? "ready" : "stopped",
            storageStatus: healthState === "ready" ? "ready" : "failed",
            migrationStatus: healthState === "ready" ? "ready" : "failed",
            timestamp: fixtureTimestamp,
        };
    return (
        <StatusSummary
            eventStreamState={eventStreamState as EventStreamState}
            health={health}
            sourceSummary={textProp(props, "sourceSummary", "尚未配置来源")}
        />
    );
}

export function renderSourceActionsLab(props: LabProps) {
    const state = optionProp(props, "state", "configured", ["configured", "untimed", "empty", "disabled", "media-policy"] as const);
    const sources: readonly SourceSnapshot[] = state === "empty"
        ? []
        : [{
            id: "source-fixture",
            name: textProp(props, "sourceName", "Cosmos fixture"),
            sourceDefinitionRef: "source.fixture-rss@1",
            operationId: "fetch",
            connectorId: "fixture-rss",
            kind: "fixture-rss",
            config: state === "untimed"
                ? {}
                : state === "media-policy"
                    ? { scheduleIntervalMs: 1_800_000, media: { images: "metadata_only", maxFileBytes: 2 * 1024 * 1024 } }
                    : { scheduleIntervalMs: 1_800_000 },
            enabled: state !== "disabled" && booleanProp(props, "enabled", true),
            revisionId: "source-fixture:1",
            createdAt: fixtureTimestamp,
            updatedAt: fixtureTimestamp,
            lastRunAt: null,
            lastError: state === "disabled" ? "Fixture source disabled" : null,
        }];
    return (
        <SourceActions
            onRun={async () => undefined}
            onToggleActivation={async () => undefined}
            onSaveMediaPolicy={async () => undefined}
            sources={sources}
        />
    );
}

export function renderRunControlLab(props: LabProps) {
    const status = optionProp(props, "status", "failed", ["queued", "running", "succeeded", "failed", "cancelled"] as const);
    const run: RunSnapshot = {
        id: "run-fixture",
        sourceId: "source-fixture",
        triggerKind: "manual",
        status,
        createdAt: fixtureTimestamp,
        startedAt: status === "queued" ? null : fixtureTimestamp,
        finishedAt: status === "succeeded" || status === "failed" || status === "cancelled" ? fixtureTimestamp : null,
        itemCount: 0,
        createdEntryCount: 0,
        revisedEntryCount: 0,
        error: status === "failed" ? "Fixture failure" : null,
    };
    const result: RunControlResult | null = status === "cancelled"
        ? { action: "cancelled", run, reuse: "已入库内容保留不回滚。", sideEffects: "取消是终态，不再产生新副作用。" }
        : null;
    return (
        <RunControl
            run={run}
            result={result}
            onCancel={async () => undefined}
            onRecover={async () => undefined}
            onRerun={async () => undefined}
        />
    );
}

const runHistoryLabRuns: readonly RunSnapshot[] = [
    {
        id: "run-failed",
        sourceId: "source-a",
        triggerKind: "manual",
        status: "failed",
        createdAt: "2026-09-10T08:00:00.000Z",
        startedAt: "2026-09-10T08:00:01.000Z",
        finishedAt: "2026-09-10T08:00:02.000Z",
        itemCount: 0,
        createdEntryCount: 0,
        revisedEntryCount: 0,
        error: "Fixture failure",
    },
    {
        id: "run-running",
        sourceId: "source-b",
        triggerKind: "schedule",
        status: "running",
        createdAt: "2026-09-10T09:00:00.000Z",
        startedAt: "2026-09-10T09:00:01.000Z",
        finishedAt: null,
        itemCount: 3,
        createdEntryCount: 3,
        revisedEntryCount: 0,
        error: null,
    },
];

const runHistoryLabClient = {
    listRuns: async () => runHistoryLabRuns,
    cancelRun: async () => ({ action: "cancelled", run: runHistoryLabRuns[1], reuse: "已入库内容保留。", sideEffects: "取消是终态。" }),
    recoverRun: async () => ({ action: "recovered", run: runHistoryLabRuns[1], reuse: "复用已持久化进度。", sideEffects: "从安全步骤续跑。" }),
    rerunRun: async () => ({ action: "rerun", run: runHistoryLabRuns[0], reuse: "复用已入库内容。", sideEffects: "从当前 checkpoint 重新抓取。" }),
} as unknown as HttpCosmosClient;

export function renderRunHistoryLab(props: LabProps) {
    const state = optionProp(props, "state", "populated", ["populated", "empty"] as const);
    const client = state === "empty"
        ? ({ listRuns: async () => [] } as unknown as HttpCosmosClient)
        : runHistoryLabClient;
    return <RunHistory client={client} />;
}

export function renderFeedBrowserLab(props: LabProps) {
    return <FeedBrowserLabFixture props={props} />;
}

function FeedBrowserLabFixture({props}: {props: LabProps}) {
    const form = useForm<SearchFormValues>({
        resolver: zodResolver(searchSchema),
        defaultValues: {
            text: "",
            sourceId: "",
            publishedAfter: "",
            publishedBefore: "",
            labelIds: [],
            topicIds: [],
        },
    });
    const state = optionProp(props, "state", "populated", ["loading", "empty", "populated"] as const);
    const feed: readonly FeedItem[] = state === "populated"
        ? [{
            storyId: "story-fixture",
            storyKind: "document",
            title: textProp(props, "title", "Cosmos fixture story"),
            summary: "A synthetic Feed item for the component laboratory.",
            entryId: "entry-fixture",
            sourceId: "source-fixture",
            sourceName: "Cosmos fixture",
            sourceKind: "fixture-rss",
            revisionId: "revision-fixture",
            publishedAt: fixtureTimestamp,
            assets: [],
        }]
        : [];
    return (
        <FeedBrowser
            feed={feed}
            loading={state === "loading"}
            onLoadMore={async () => undefined}
            onOpenStory={async () => undefined}
            onSubmit={(event) => event.preventDefault()}
            searchForm={form}
            nextCursor={state === "populated" ? "fixture-next" : null}
            labels={[{id: "label-fixture", name: "开发"}]}
            topics={[{
                id: "topic-fixture",
                revisionId: "revision-topic-fixture",
                title: "Cosmos fixture topic",
                purpose: "一个用于组件检查的合成 Topic。",
                scope: null,
                memberCount: 1,
                updatedAt: fixtureTimestamp,
            }]}
            sources={[{
                id: "source-fixture",
                name: "Cosmos fixture",
                sourceDefinitionRef: "source.fixture-rss@1",
                operationId: "fetch",
                connectorId: "fixture-rss",
                kind: "fixture-rss",
                config: {fixturePath: "fixtures/rss/basic.xml"},
                enabled: true,
                revisionId: "source-fixture:1",
                createdAt: fixtureTimestamp,
                updatedAt: fixtureTimestamp,
                lastRunAt: null,
                lastError: null,
            }]}
        />
    );
}

export function renderStoryPanelLab(props: LabProps) {
    const state = optionProp(
        props,
        "state",
        "revision",
        ["revision", "empty", "split", "splittable", "legacy-subtype"] as const,
    );
    const title = textProp(props, "title", "Cosmos fixture story");
    const contentText = textProp(props, "contentText", "A synthetic Story body for component inspection.");
    const memberEntry: EntryDetail = {
        id: "entry-fixture",
        sourceId: "source-fixture",
        sourceName: "Cosmos fixture",
        sourceKind: "fixture-rss",
        currentRevisionId: "revision-fixture",
        metrics: null,
        revisions: state === "empty" ? [] : [{
            id: "revision-fixture",
            revision: 1,
            title,
            summary: "A synthetic Story summary.",
            contentText,
            webUrl: null,
            contentKind: "article",
            publisher: null,
            publishedAt: null,
            updatedAt: null,
            sourcePublishedAt: null,
            createdAt: fixtureTimestamp,
            assets: [],
        }],
        observations: [{
            id: "observation-fixture",
            externalId: null,
            externalKey: "fixture:story",
            eventKind: "snapshot",
            webUrl: null,
            capturedAt: fixtureTimestamp,
            sourcePublishedAt: null,
        }],
        relatedStories: [{
            storyId: "story-evidenced-fixture",
            relationType: "evidence_for",
            title: "A fixture event Story this entry is evidence for",
            reason: "同一事件",
        }],
    };
    const secondEntry: EntryDetail = {
        ...memberEntry,
        id: "entry-fixture-2",
        sourceId: "source-fixture-2",
        sourceName: "Cosmos fixture source 2",
        currentRevisionId: "revision-fixture-2",
        revisions: memberEntry.revisions.map((revision) => ({
            ...revision,
            id: "revision-fixture-2",
            title: "A second fixture member",
        })),
        observations: [],
        relatedStories: [],
    };
    const story: StoryDetail = {
        story: {
            id: "story-fixture",
            kind: state === "legacy-subtype" ? "media" : "document",
            subtype: state === "legacy-subtype" ? "media.legacy" : null,
            revisionId: "revision-fixture",
            title,
            summary: "A synthetic Story summary.",
            status: state === "split" ? "split" : "active",
            replacedBy: state === "split"
                ? [
                    { storyId: "story-successor-a", title: "Fixture successor A", kind: "event" },
                    { storyId: "story-successor-b", title: "Fixture successor B", kind: "document" },
                ]
                : [],
        },
        entry: state === "split" ? null : memberEntry,
        entries: state === "split"
            ? []
            : state === "splittable"
                ? [memberEntry, secondEntry]
                : [memberEntry],
        entities: [],
        topics: [],
        labels: [],
        favorited: false,
        evidence: [{
            entryId: "entry-evidence-fixture",
            sourceId: "source-fixture",
            sourceName: "Cosmos fixture source",
            relationType: "evidence_for",
            title: "A fixture entry that supports this Story",
            producer: "human",
            producerVersion: null,
            confidence: 1,
            evidence: "官方公告",
            actor: null,
            reason: "同一事件",
        }],
    };
    return (
        <StoryPanel
            onClose={() => undefined}
            story={story}
            onUpdateStoryRevision={async () => undefined}
            onMergeStory={async () => undefined}
            onSplitStory={async () => undefined}
            subtypeOptions={labStorySubtypeOptions}
            relatedStories={[{
                storyId: "story-related-fixture",
                title: "A related but different fixture Story",
                reason: "共享分类：开发",
            }]}
        />
    );
}

export function renderThemeSwitcherLab(props: LabProps) {
    const value = optionProp(
        props,
        "value",
        "system",
        ["system", "macos-light", "macos-night"] as const,
    );
    return (
        <ThemeSwitcher
            onValueChange={() => undefined}
            value={value as CosmosThemePreference}
        />
    );
}

export function renderTopicPanelLab(props: LabProps) {
    const title = textProp(props, "title", "Cosmos fixture topic");
    const purpose = textProp(props, "purpose", "一个用于组件检查的合成 Topic。");
    const state = optionProp(props, "state", "members", ["members", "empty", "removed"] as const);
    const topic: TopicDetail = {
        topic: {
            id: "topic-fixture",
            revisionId: "rev-t-fixture",
            title,
            purpose,
            scope: null,
        },
        members: state === "empty"
            ? []
            : [{
                storyId: "story-fixture-a",
                role: "core",
                reason: "seed",
                actor: "user",
                revision: 1,
                removed: false,
            }, {
                storyId: "story-fixture-b",
                role: "background",
                reason: "背景",
                actor: "user",
                revision: 1,
                removed: state === "removed",
            }],
    };
    return (
        <TopicPanel
            onClose={() => undefined}
            topic={topic}
            onUpdateTopic={async () => undefined}
            onUpdateMemberRole={async () => undefined}
            onRemoveMember={async () => undefined}
            onRestoreMember={async () => undefined}
        />
    );
}

export function renderEntityPanelLab(props: LabProps) {
    const name = textProp(props, "name", "Jeff Dean");
    const type = optionProp(props, "type", "person", ["person", "organization", "model"] as const);
    const state = optionProp(props, "state", "linked", ["linked", "empty"] as const);
    const targetOptions: readonly EntitySummary[] = [{
        id: "entity-fixture-loop",
        revisionId: "rev-e-fixture-loop",
        type: "organization",
        name: "Discovery Loop",
        storyCount: 0,
        relationCount: 0,
        updatedAt: fixtureTimestamp,
    }];
    const entity: EntityDetail = {
        entity: {
            id: "entity-fixture",
            revisionId: "rev-e-fixture",
            type,
            name,
        },
        aliases: ["Jeffrey Dean"],
        stories: state === "empty"
            ? []
            : [{
                storyId: "story-fixture-a",
                producer: "human",
                producerVersion: null,
                confidence: 1,
                evidence: null,
                actor: "user",
                reason: null,
            }],
        relations: state === "empty"
            ? []
            : [{
                fromEntityId: "entity-fixture",
                toEntityId: "entity-fixture-loop",
                relationType: "founded",
                producer: "human",
                producerVersion: null,
                confidence: 0.9,
                evidence: null,
                actor: "user",
                reason: "已知履历",
            }],
    };
    return (
        <EntityPanel
            onClose={() => undefined}
            entity={entity}
            entityOptions={targetOptions}
            onUpdateEntity={async () => undefined}
            onAddAlias={async () => undefined}
            onRemoveAlias={async () => undefined}
            onUnlinkStory={async () => undefined}
            onCreateRelation={async () => undefined}
            onRemoveRelation={async () => undefined}
        />
    );
}

const labBoardClient = new HttpCosmosClient({ baseUrl: "" });

export function renderBoardViewLab(props: LabProps) {
    const state = optionProp(props, "state", "default", ["default", "unknown-block"] as const);
    const timestamp = fixtureTimestamp;
    const hotBlock: BoardBlock = {
        id: "block-fixture-hot",
        sectionId: "section-fixture-hot",
        // source-health 渲染页面传入的插槽，实验室零请求；spotlight/collection
        // 是自取数区块，不在 fixture 中出现（真实流程由浏览器 E2E 覆盖）。
        type: "source-health",
        config: {},
        position: 0,
        visible: true,
        createdAt: timestamp,
        updatedAt: timestamp,
    };
    const feedBlock: BoardBlock = {
        id: "block-fixture-feed",
        sectionId: "section-fixture-feed",
        type: "feed",
        config: {},
        position: 0,
        visible: true,
        createdAt: timestamp,
        updatedAt: timestamp,
    };
    const topicBlock: BoardBlock = {
        id: "block-fixture-topics",
        sectionId: "section-fixture-feed",
        type: "topic-list",
        config: { limit: 5 },
        position: 1,
        visible: true,
        createdAt: timestamp,
        updatedAt: timestamp,
    };
    const unknownBlock: BoardBlock = {
        id: "block-fixture-unknown",
        sectionId: "section-fixture-feed",
        type: "gadget",
        config: {},
        position: 2,
        visible: true,
        createdAt: timestamp,
        updatedAt: timestamp,
    };
    const board: BoardDetail = {
        id: "board-fixture",
        name: "默认看板",
        description: null,
        sections: [
            {
                id: "section-fixture-hot",
                boardId: "board-fixture",
                title: "热点",
                position: 0,
                blocks: [hotBlock],
                createdAt: timestamp,
                updatedAt: timestamp,
            },
            {
                id: "section-fixture-feed",
                boardId: "board-fixture",
                title: "信息流",
                position: 1,
                blocks: state === "unknown-block"
                    ? [feedBlock, topicBlock, unknownBlock]
                    : [feedBlock, topicBlock],
                createdAt: timestamp,
                updatedAt: timestamp,
            },
        ],
        createdAt: timestamp,
        updatedAt: timestamp,
    };
    return (
        <BoardView
            board={board}
            client={labBoardClient}
            feedSlot={(
                <div className="rounded-[var(--radius-panel)] border border-dashed px-6 py-10 text-sm text-muted-foreground">
                    合成阅读流区块（实验室不发起 Product API 请求）。
                </div>
            )}
            sourceActionsSlot={(
                <div className="rounded-[var(--radius-panel)] border border-dashed px-6 py-10 text-sm text-muted-foreground">
                    合成来源健康区块。
                </div>
            )}
            topics={[{
                id: "topic-fixture",
                revisionId: "rev-t-fixture",
                title: "Qwen 3.8 发布跟踪",
                purpose: "合成 Topic",
                scope: null,
                memberCount: 3,
                updatedAt: timestamp,
            }]}
            openingTopicId={null}
            onOpenTopic={() => undefined}
            onOpenStory={() => undefined}
        />
    );
}
