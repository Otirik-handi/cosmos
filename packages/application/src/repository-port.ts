/** 仓储端口与证据链接输入。 */

import type {
    CreateSourceCommand, ConnectionInstance, CreateConnectionCommand,
    CollectionPlanSnapshot,
    UpdateConnectionCommand, StorageStats, BackupSnapshot, FeedPage,
    EntryDetail, EntryPage, JobSnapshot, RevisionDetail,
    RunSnapshot, SearchPage, SearchQuery, SourceActivationCommand,
    SourceCheckpointOutput, SourceConfigProbeCommand, SourceSnapshot,
    StoryDetail, StoryUserStateMigrationResult, TopicDetail, TopicPage, UpdateSourceCommand,
    EntityDetail, EntityPage, LabelDetail, LabelItem, LabelList,
    CollectionDetail, CollectionList, CollectionSummary, FavoriteList,
    Annotation, AnnotationList, SavedView, SavedViewList,
    BoardDetail, BoardList, SpotlightPlacement, SpotlightPlacementList,
    UserDataExport,
} from "@cosmos/contracts";
import type {
    EntityRelationType, EntityType, EntryRelationType, EntryStoryRelationType, FavoriteTargetType,
    NormalizedIngestItem, StoryKeyFact, StoryKind, StorySubtypeRegistration, StoryTimeRange,
    TargetType, TopicMemberRole,
    BlockType, SpotlightTargetType,
} from "@cosmos/domain";
import type {
    HostActionExecutionFence,
} from "./action.js";

import type {
    MediaCleanupReport,
} from "@cosmos/contracts";
import type {
    MediaRetryCandidate, MediaRetryOutcome,
} from "./media-acquisition.js";

import type {
    JobLease,
} from "./connector-ports.js";
import {
    retryDelayMs,
} from "./internals.js";
import type {
    MediaCleanupCandidate, PersistIngestItemResult, RepositoryHealth,
    WorkflowAttemptSnapshot,
} from "./result-types.js";

export interface EntityLinkProvenanceInput {
    producer?: string | null;
    producerVersion?: string | null;
    confidence?: number | null;
    evidence?: string | null;
}

export interface CosmosRepository {
    createSource(input: CreateSourceCommand): Promise<SourceSnapshot>;
    listSources(): Promise<readonly SourceSnapshot[]>;
    getSource(sourceId: string): Promise<SourceSnapshot | null>;
    updateSource(sourceId: string, input: UpdateSourceCommand): Promise<SourceSnapshot>;
    activateSource(input: SourceActivationCommand & {
        sourceId: string;
        idempotencyKey: string;
    }): Promise<SourceSnapshot>;
    /** 删除来源 = 墓碑 + 移除调度绑定；已录入历史保留（AUT-001）。 */
    deleteSource(input: {
        sourceId: string;
        baseRevisionId: string;
        idempotencyKey: string;
        actor: string | null;
        reason: string | null;
    }): Promise<SourceSnapshot>;
    createConnection(input: CreateConnectionCommand): Promise<ConnectionInstance>;
    listConnections(): Promise<readonly ConnectionInstance[]>;
    getConnection(connectionId: string): Promise<ConnectionInstance | null>;
    updateConnection(connectionId: string, input: UpdateConnectionCommand): Promise<ConnectionInstance>;
    deleteConnection(connectionId: string): Promise<boolean>;
    /** 计划读投影（ADR-0023）：产品面的对象是计划，按计划读取连接、频率与媒体预算。 */
    listCollectionPlans(): Promise<readonly CollectionPlanSnapshot[]>;
    getCollectionPlan(planId: string): Promise<CollectionPlanSnapshot | null>;
    /** Enabled schedule trigger bindings (ADR-0018) for the scheduler loop. */
    listScheduleTriggers(): Promise<readonly {
        planId: string;
        sourceId: string;
        intervalMs: number;
        lastRunAt: string | null;
    }[]>;
    /** Storage occupancy snapshot (ADR-0019 / OPS-003). */
    getStorageStats(): Promise<StorageStats>;
    /** List database backups inside the data root (ADR-0019 / OPS-004). */
    listBackups(): Promise<readonly BackupSnapshot[]>;
    /** Create a consistent SQLite backup and return its snapshot. */
    createBackup(): Promise<BackupSnapshot>;
    /** Restore a backup over the current database (creates a pre-restore backup). */
    restoreBackup(backupId: string): Promise<void>;
    /** 用户真相对象的可带走副本（LIB-008 / OPS-004）；只读，不落盘。 */
    exportUserData(): Promise<UserDataExport>;
    createRun(input: {
        sourceId: string;
        triggerKind: "manual" | "schedule";
    }): Promise<RunSnapshot>;
    createQueuedRun(input: {
        sourceId: string;
        triggerKind: "manual" | "schedule";
        idempotencyKey?: string;
    }): Promise<RunSnapshot>;
    createProbeJob(input: {
        sourceId: string;
        idempotencyKey?: string;
    }): Promise<JobSnapshot>;
    createConfigProbeJob(input: {
        command: SourceConfigProbeCommand;
        idempotencyKey?: string;
    }): Promise<JobSnapshot>;
    startRun(runId: string, lease?: JobLease): Promise<RunSnapshot>;
    getRun(runId: string): Promise<RunSnapshot | null>;
    getJob(jobId: string): Promise<JobSnapshot | null>;
    /** 某个 Run 的 Job（OPS-002）；`runId` 兼容 legacy Run 与 durable WorkflowRun。 */
    listRunJobs(runId: string): Promise<readonly JobSnapshot[]>;
    listWorkflowAttempts(jobId: string): Promise<readonly WorkflowAttemptSnapshot[]>;
    getWorkflowAttempt(attemptId: string): Promise<WorkflowAttemptSnapshot | null>;
    getCheckpoint(sourceId: string): Promise<string | null>;
    getCheckpointSnapshot(sourceId: string): Promise<{
        cursor: string | null;
        revision: number;
    }>;
    listContentUnchangedItems(input: {
        sourceId: string;
        items: readonly NormalizedIngestItem[];
    }): Promise<readonly boolean[]>;
    /**
     * Degraded image Assets of a source that may be attempted again: still below
     * the attempt ceiling and degraded for a retryable reason (ADR-0015).
     */
    listRetryableMediaAssets(input: {
        sourceId: string;
        maxAttempts: number;
        limit?: number;
    }): Promise<readonly MediaRetryCandidate[]>;
    /**
     * Apply one retry outcome in place. Rewrites only the Asset row (never the
     * EntryRevision) and uses `(assetId, attemptCount)` as CAS so concurrent
     * retries of the same Asset collapse into one write (ADR-0015 decision 4).
     */
    applyMediaRetryOutcome(input: {
        workflowRunId: string;
        fence: HostActionExecutionFence;
        outcome: MediaRetryOutcome;
        expectedAttemptCount: number;
    }): Promise<boolean>;
    /** Saved media of sources whose per-source retention window has expired. */
    listRetentionCleanupCandidates(input: {
        sourceId?: string | null;
        now?: Date;
        limit?: number;
    }): Promise<readonly MediaCleanupCandidate[]>;
    /**
     * Delete expired media bytes and degrade the Asset rows (ADR-0015 decision
     * 8). `dryRun` only reports; otherwise every row is updated and its blob is
     * removed once proven unreferenced (decision 9).
     */
    runMediaCleanup(input: {
        workflowRunId: string;
        fence: HostActionExecutionFence;
        sourceId: string | null;
        dryRun: boolean;
    }): Promise<MediaCleanupReport>;
    /** Latest cleanup report recorded for a Run, if the Action already ran. */
    getMediaCleanupReport(runId: string): Promise<MediaCleanupReport | null>;
    claimNextJob(input: {
        owner: string;
        leaseMs: number;
        acceptedKinds: readonly string[];
    }): Promise<{
        id: string;
        runId: string | null;
        kind: string;
        leaseToken: string;
        attempts: number;
        maxAttempts: number;
        payload: unknown;
    } | null>;
    renewJobLease(input: {
        jobId: string;
        leaseToken: string;
        leaseMs: number;
    }): Promise<boolean>;
    completeJob(input: {
        jobId: string;
        leaseToken: string;
        status: "succeeded" | "retry_wait" | "failed_terminal";
        error?: string | null;
        errorCode?: string | null;
        result?: unknown;
        retryDelayMs?: number;
    }): Promise<boolean>;
    resetRunForRetry(input: {
        runId: string;
        error?: string | null;
        lease?: JobLease;
    }): Promise<RunSnapshot>;
    persistIngestItem(input: {
        sourceId: string;
        runId: string;
        item: NormalizedIngestItem;
    }): Promise<PersistIngestItemResult>;
    persistWorkflowIngestItem(input: {
        sourceId: string;
        workflowRunId: string;
        triggerKind: "manual" | "schedule";
        item: NormalizedIngestItem;
        fence: HostActionExecutionFence;
        idempotencyKey: string;
    }): Promise<PersistIngestItemResult>;
    setWorkflowIngestCheckpoint(input: {
        sourceId: string;
        workflowRunId: string;
        cursor: string | null;
        expectedRevision: number;
        itemCount: number;
        fence: HostActionExecutionFence;
        idempotencyKey: string;
    }): Promise<SourceCheckpointOutput>;
    setCheckpoint(sourceId: string, cursor: string | null): Promise<void>;
    completeRun(input: {
        runId: string;
        status: "succeeded" | "failed" | "cancelled";
        error?: string | null;
        lease?: JobLease;
    }): Promise<RunSnapshot>;
    feed(input: {
        cursor?: string;
        limit: number;
    }): Promise<FeedPage>;
    search(input: SearchQuery): Promise<SearchPage>;
    entries(input: {
        sourceId?: string;
        cursor?: string;
        limit: number;
    }): Promise<EntryPage>;
    story(storyId: string): Promise<StoryDetail | null>;
    listStorySubtypes(input?: { kind?: StoryKind }): Promise<StorySubtypeRegistration[]>;
    moveEntryToStory(input: {
        entryId: string;
        storyId: string;
        actor?: string | null;
        reason?: string | null;
    }): Promise<StoryDetail | null>;
    updateStoryRevision(input: {
        storyId: string;
        baseRevisionId: string;
        title: string;
        summary: string | null;
        kind: StoryKind;
        subtype: string | null;
        // Full-representation submit: an omitted extension is stored as empty
        // (ADR-0021 decision 5).
        timeRange?: StoryTimeRange | null;
        keyFacts?: readonly StoryKeyFact[] | null;
        actor?: string | null;
        reason?: string | null;
    }): Promise<StoryDetail | null>;
    mergeStories(input: {
        canonicalStoryId: string;
        obsoleteStoryIds: readonly string[];
        actor?: string | null;
        reason?: string | null;
    }): Promise<StoryDetail | null>;
    splitStory(input: {
        storyId: string;
        successors: readonly {
            title: string;
            summary: string | null;
            kind: StoryKind;
            subtype: string | null;
            // Each successor carries its own representation; the shell's is not
            // copied (ADR-0021 decision 6).
            timeRange?: StoryTimeRange | null;
            keyFacts?: readonly StoryKeyFact[] | null;
            entryIds: readonly string[];
            evidenceEntryIds: readonly string[];
            entityIds: readonly string[];
            topicIds: readonly string[];
        }[];
        actor?: string | null;
        reason?: string | null;
    }): Promise<StoryDetail | null>;
    migrateStoryUserState(input: {
        sourceStoryId: string;
        targetStoryId: string;
        favorite: boolean;
        labelIds: readonly string[];
        collectionIds: readonly string[];
        annotationIds: readonly string[];
        spotlightPlacementIds: readonly string[];
        actor?: string | null;
        reason?: string | null;
        basis?: string | null;
    }): Promise<StoryUserStateMigrationResult>;
    createTopic(input: {
        title: string;
        purpose: string;
        scope: string | null;
        seedStoryId?: string | null;
        actor?: string | null;
        reason?: string | null;
    }): Promise<TopicDetail | null>;
    updateTopic(input: {
        topicId: string;
        baseRevisionId: string;
        title: string;
        purpose: string;
        scope: string | null;
        actor?: string | null;
        reason?: string | null;
    }): Promise<TopicDetail | null>;
    mergeTopics(input: {
        canonicalTopicId: string;
        obsoleteTopicIds: readonly string[];
        actor?: string | null;
        reason?: string | null;
    }): Promise<TopicDetail | null>;
    topic(topicId: string): Promise<TopicDetail | null>;
    listTopics(input: {
        cursor?: string;
        limit: number;
    }): Promise<TopicPage>;
    addTopicMember(input: {
        topicId: string;
        storyId: string;
        role: TopicMemberRole;
        reason?: string | null;
        actor?: string | null;
    }): Promise<TopicDetail | null>;
    updateTopicMemberRole(input: {
        topicId: string;
        storyId: string;
        role: TopicMemberRole;
        reason?: string | null;
        actor?: string | null;
    }): Promise<TopicDetail | null>;
    removeTopicMember(input: {
        topicId: string;
        storyId: string;
        reason?: string | null;
        actor?: string | null;
    }): Promise<TopicDetail | null>;
    restoreTopicMember(input: {
        topicId: string;
        storyId: string;
        role: TopicMemberRole;
        reason?: string | null;
        actor?: string | null;
    }): Promise<TopicDetail | null>;
    createEntity(input: {
        name: string;
        type: EntityType;
        alias?: string | null;
        actor?: string | null;
        reason?: string | null;
    }): Promise<EntityDetail | null>;
    updateEntity(input: {
        entityId: string;
        baseRevisionId: string;
        name: string;
        type: EntityType;
        actor?: string | null;
        reason?: string | null;
    }): Promise<EntityDetail | null>;
    addEntityAlias(input: {
        entityId: string;
        name: string;
        actor?: string | null;
        reason?: string | null;
    }): Promise<EntityDetail | null>;
    removeEntityAlias(input: {
        entityId: string;
        name: string;
        actor?: string | null;
        reason?: string | null;
    }): Promise<EntityDetail | null>;
    linkStoryEntity(input: {
        storyId: string;
        entityId: string;
        producer?: string | null;
        producerVersion?: string | null;
        confidence?: number | null;
        evidence?: string | null;
        actor?: string | null;
        reason?: string | null;
    }): Promise<EntityDetail | null>;
    unlinkStoryEntity(input: {
        storyId: string;
        entityId: string;
        actor?: string | null;
        reason?: string | null;
    }): Promise<EntityDetail | null>;
    /**
     * Links an Entry to another Story as evidence/mention. Returns the target
     * Story detail so callers can refresh the evidence list in one round trip.
     */
    linkEntryStory(input: {
        entryId: string;
        storyId: string;
        relationType: EntryStoryRelationType;
        producer?: string | null;
        producerVersion?: string | null;
        confidence?: number | null;
        evidence?: string | null;
        actor?: string | null;
        reason?: string | null;
    }): Promise<StoryDetail | null>;
    unlinkEntryStory(input: {
        entryId: string;
        storyId: string;
        actor?: string | null;
        reason?: string | null;
    }): Promise<StoryDetail | null>;
    /**
     * One current relation per unordered Entry pair (ADR-0022 decision 2), so a
     * repeated write overwrites and the result is the `fromEntryId` side, which
     * is what the caller just asserted.
     */
    linkEntryRelation(input: {
        fromEntryId: string;
        toEntryId: string;
        relationType: EntryRelationType;
        producer?: string | null;
        producerVersion?: string | null;
        confidence?: number | null;
        evidence?: string | null;
        actor?: string | null;
        reason?: string | null;
    }): Promise<EntryDetail | null>;
    unlinkEntryRelation(input: {
        fromEntryId: string;
        toEntryId: string;
        actor?: string | null;
        reason?: string | null;
    }): Promise<EntryDetail | null>;
    createEntityRelation(input: {
        fromEntityId: string;
        toEntityId: string;
        relationType: EntityRelationType;
        producer?: string | null;
        producerVersion?: string | null;
        confidence?: number | null;
        evidence?: string | null;
        actor?: string | null;
        reason?: string | null;
    }): Promise<EntityDetail | null>;
    removeEntityRelation(input: {
        fromEntityId: string;
        toEntityId: string;
        relationType: string;
        actor?: string | null;
        reason?: string | null;
    }): Promise<EntityDetail | null>;
    entity(entityId: string): Promise<EntityDetail | null>;
    listEntities(input: {
        cursor?: string;
        limit: number;
    }): Promise<EntityPage>;
    createLabel(input: {
        name: string;
    }): Promise<LabelItem>;
    listLabels(): Promise<LabelList>;
    label(labelId: string): Promise<LabelDetail | null>;
    deleteLabel(labelId: string): Promise<void>;
    attachLabel(input: {
        labelId: string;
        targetType: TargetType;
        targetId: string;
    }): Promise<void>;
    detachLabel(input: {
        labelId: string;
        targetType: TargetType;
        targetId: string;
    }): Promise<void>;
    createCollection(input: {
        name: string;
        description?: string | null;
    }): Promise<CollectionSummary>;
    updateCollection(input: {
        collectionId: string;
        name: string;
        description?: string | null;
    }): Promise<CollectionSummary>;
    deleteCollection(collectionId: string): Promise<void>;
    listCollections(input?: {
        storyId?: string;
    }): Promise<CollectionList>;
    collection(collectionId: string): Promise<CollectionDetail | null>;
    addCollectionItem(input: {
        collectionId: string;
        storyId: string;
    }): Promise<void>;
    removeCollectionItem(input: {
        collectionId: string;
        storyId: string;
    }): Promise<void>;
    setFavorite(input: {
        targetType: FavoriteTargetType;
        targetId: string;
    }): Promise<void>;
    unsetFavorite(input: {
        targetType: FavoriteTargetType;
        targetId: string;
    }): Promise<void>;
    listFavorites(): Promise<FavoriteList>;
    createAnnotation(input: {
        targetType: TargetType;
        targetId: string;
        body: string;
        quote?: string | null;
        evidence?: string | null;
        actor?: string | null;
    }): Promise<Annotation>;
    updateAnnotation(input: {
        annotationId: string;
        body: string;
        quote?: string | null;
        evidence?: string | null;
        actor?: string | null;
    }): Promise<Annotation | null>;
    deleteAnnotation(annotationId: string): Promise<void>;
    listAnnotations(input: {
        targetType: TargetType;
        targetId: string;
    }): Promise<AnnotationList>;
    createSavedView(input: {
        name: string;
        conditions: {
            text?: string | null;
            sourceId?: string | null;
            publishedAfter?: string | null;
            publishedBefore?: string | null;
            labelIds?: readonly string[] | null;
            topicIds?: readonly string[] | null;
        };
    }): Promise<SavedView>;
    updateSavedView(input: {
        savedViewId: string;
        name: string;
        conditions: {
            text?: string | null;
            sourceId?: string | null;
            publishedAfter?: string | null;
            publishedBefore?: string | null;
            labelIds?: readonly string[] | null;
            topicIds?: readonly string[] | null;
        };
    }): Promise<SavedView | null>;
    deleteSavedView(savedViewId: string): Promise<void>;
    listSavedViews(): Promise<SavedViewList>;
    // Board/Section/Block writes return the full board tree so a client can
    // refresh the dashboard from one response (ADR-0010: config rows are tiny).
    listBoards(): Promise<BoardList>;
    getBoard(boardId: string): Promise<BoardDetail | null>;
    createBoard(input: {
        name: string;
        description?: string | null;
    }): Promise<BoardDetail>;
    updateBoard(input: {
        boardId: string;
        name: string;
        description?: string | null;
    }): Promise<BoardDetail>;
    deleteBoard(boardId: string): Promise<void>;
    createSection(input: {
        boardId: string;
        title: string;
        position?: number | null;
    }): Promise<BoardDetail>;
    updateSection(input: {
        sectionId: string;
        title: string;
        position?: number | null;
    }): Promise<BoardDetail>;
    deleteSection(sectionId: string): Promise<void>;
    createBlock(input: {
        sectionId: string;
        type: BlockType;
        config: Record<string, unknown>;
        position?: number | null;
    }): Promise<BoardDetail>;
    updateBlockConfig(input: {
        blockId: string;
        config: Record<string, unknown>;
    }): Promise<BoardDetail>;
    moveBlock(input: {
        blockId: string;
        sectionId?: string | null;
        position: number;
    }): Promise<BoardDetail>;
    setBlockVisibility(input: {
        blockId: string;
        visible: boolean;
    }): Promise<BoardDetail>;
    duplicateBlock(blockId: string): Promise<BoardDetail>;
    deleteBlock(blockId: string): Promise<void>;
    /**
     * Idempotent application-side seed (ADR-0010 decision 4): creates the
     * default board with hot/curation/feed sections when no board exists;
     * returns the existing or newly created default board otherwise.
     */
    ensureDefaultBoard(): Promise<BoardDetail>;
    // Manual spotlight placements (ADR-0010 decision 3): pin is idempotent on
    // (boardId, targetType, targetId); unpin removes the row.
    listSpotlightPlacements(query?: {
        boardId?: string | null;
    }): Promise<SpotlightPlacementList>;
    createSpotlightPlacement(input: {
        boardId: string;
        targetType: SpotlightTargetType;
        targetId: string;
        reason?: string | null;
        actor?: string | null;
    }): Promise<SpotlightPlacement>;
    deleteSpotlightPlacement(placementId: string): Promise<void>;
    entry(entryId: string): Promise<EntryDetail | null>;
    revision(revisionId: string): Promise<RevisionDetail | null>;
    events(input: {
        afterSequence: number;
        limit: number;
    }): Promise<readonly {
        id: string;
        type: string;
        version: string;
        occurredAt: string;
        payload: unknown;
    }[]>;
    latestEventSequence(): Promise<number>;
    readAsset(assetId: string): Promise<{
        content: Uint8Array;
        mimeType: string;
    } | null>;
    touchWorkerHeartbeat(input: {
        instanceId: string;
        status: "starting" | "ready" | "stopped";
        version: string;
    }): Promise<void>;
    health(): Promise<RepositoryHealth>;
}
