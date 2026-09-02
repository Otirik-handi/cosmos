import {useMemo} from "react";
import {zodResolver} from "@hookform/resolvers/zod";
import {useForm} from "react-hook-form";

import type {
    FeedItem,
    HealthResponse,
    SourceConfigProbeResult,
    SourceDefinitionManifest,
    SourceSnapshot,
    StoryDetail,
} from "@cosmos/contracts";

import {FeedBrowser, searchSchema, type SearchFormValues} from "@/components/cosmos/feed-browser";
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
import {ThemeSwitcher} from "@/components/cosmos/theme-switcher";

import type {CosmosThemePreference} from "@/theme/theme";

import type {LabProps} from "./types";

const fixtureTimestamp = "2026-01-01T00:00:00.000Z";

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
    const state = optionProp(props, "state", "configured", ["configured", "empty", "disabled"] as const);
    const sources: readonly SourceSnapshot[] = state === "empty"
        ? []
        : [{
            id: "source-fixture",
            name: textProp(props, "sourceName", "Cosmos fixture"),
            sourceDefinitionRef: "source.fixture-rss@1",
            operationId: "fetch",
            connectorId: "fixture-rss",
            kind: "fixture-rss",
            config: {fixturePath: "fixtures/rss/basic.xml"},
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
            sources={sources}
        />
    );
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
    const state = optionProp(props, "state", "revision", ["revision", "empty"] as const);
    const title = textProp(props, "title", "Cosmos fixture story");
    const contentText = textProp(props, "contentText", "A synthetic Story body for component inspection.");
    const story: StoryDetail = {
        story: {
            id: "story-fixture",
            kind: "document",
            subtype: null,
            revisionId: "revision-fixture",
            title,
            summary: "A synthetic Story summary.",
        },
        entry: {
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
        },
    };
    return <StoryPanel onClose={() => undefined} story={story} />;
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
