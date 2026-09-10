import {
    createSourceCommandSchema,
    connectorDescriptorSchema,
    feedPageSchema,
    healthResponseSchema,
    jobSnapshotSchema,
    mergeStoriesCommandSchema,
    moveEntryToStoryCommandSchema,
    splitStoryCommandSchema,
    mediaCleanupCommandSchema,
    mediaCleanupRunSnapshotSchema,
    runSnapshotSchema,
    searchPageSchema,
    sourceActivationCommandSchema,
    sourceConfigProbeCommandSchema,
    sourceConfigProbeJobSnapshotSchema,
    sourceDefinitionPageSchema,
    sourceSnapshotSchema,
    storyDetailSchema,
    storySubtypePageSchema,
    topicDetailSchema,
    topicPageSchema,
    addTopicMemberCommandSchema,
    createTopicCommandSchema,
    mergeTopicsCommandSchema,
    removeTopicMemberCommandSchema,
    restoreTopicMemberCommandSchema,
    updateTopicCommandSchema,
    updateTopicMemberRoleCommandSchema,
    updateStoryRevisionCommandSchema,
    entryDetailSchema,
    entryPageSchema,
    revisionDetailSchema,
    sseEventSchema,
    type CreateSourceCommand,
    type ConnectorDescriptor,
    type FeedPage,
    type HealthResponse,
    type JobSnapshot,
    type RunSnapshot,
    type SearchPage,
    type SearchQuery,
    type SourceActivationCommand,
    type SourceConfigProbeCommand,
    type SourceConfigProbeJobSnapshot,
    type SourceDefinitionManifest,
    type SourceSnapshot,
    type MediaCleanupCommand,
    type MediaCleanupRunSnapshot,
    type StoryDetail,
    type StorySubtype,
    type SseEvent,
    type TopicDetail,
    type TopicPage,
    type AddTopicMemberCommand,
    type CreateTopicCommand,
    type MergeTopicsCommand,
    type RemoveTopicMemberCommand,
    type RestoreTopicMemberCommand,
    type UpdateTopicCommand,
    type UpdateTopicMemberRoleCommand,
    type EntryDetail,
    type EntryListQuery,
    type EntryPage,
    type MergeStoriesCommand,
    type SplitStoryCommand,
    type MoveEntryToStoryCommand,
    type RevisionDetail,
    type UpdateStoryRevisionCommand,
    type UpdateSourceCommand,
    entityDetailSchema,
    entityPageSchema,
    createEntityCommandSchema,
    updateEntityCommandSchema,
    addEntityAliasCommandSchema,
    removeEntityAliasCommandSchema,
    linkStoryEntityCommandSchema,
    unlinkStoryEntityCommandSchema,
    linkEntryStoryCommandSchema,
    unlinkEntryStoryCommandSchema,
    createEntityRelationCommandSchema,
    removeEntityRelationCommandSchema,
    labelListSchema,
    labelDetailSchema,
    labelItemSchema,
    collectionListSchema,
    collectionDetailSchema,
    collectionSummarySchema,
    favoriteListSchema,
    annotationSchema,
    annotationListSchema,
    createAnnotationCommandSchema,
    updateAnnotationCommandSchema,
    savedViewSchema,
    savedViewListSchema,
    createSavedViewCommandSchema,
    updateSavedViewCommandSchema,
    userOrganizationAckSchema,
    boardCommandAckSchema,
    boardDetailSchema,
    boardListSchema,
    createBlockCommandSchema,
    createBoardCommandSchema,
    createSectionCommandSchema,
    moveBlockCommandSchema,
    setBlockVisibilityCommandSchema,
    updateBlockConfigCommandSchema,
    updateBoardCommandSchema,
    updateSectionCommandSchema,
    pinSpotlightCommandSchema,
    spotlightPlacementListSchema,
    spotlightPlacementSchema,
    createLabelCommandSchema,
    labelAssignmentCommandSchema,
    createCollectionCommandSchema,
    updateCollectionCommandSchema,
    collectionItemCommandSchema,
    favoriteCommandSchema,
    type EntityDetail,
    type EntityPage,
    type CreateEntityCommand,
    type UpdateEntityCommand,
    type AddEntityAliasCommand,
    type RemoveEntityAliasCommand,
    type LinkStoryEntityCommand,
    type UnlinkStoryEntityCommand,
    type LinkEntryStoryCommand,
    type UnlinkEntryStoryCommand,
    type CreateEntityRelationCommand,
    type RemoveEntityRelationCommand,
    type LabelList,
    type LabelDetail,
    type LabelItem,
    type CollectionList,
    type CollectionDetail,
    type CollectionSummary,
    type FavoriteList,
    type Annotation,
    type AnnotationList,
    type CreateAnnotationCommand,
    type UpdateAnnotationCommand,
    type SavedView,
    type SavedViewList,
    type CreateSavedViewCommand,
    type UpdateSavedViewCommand,
    type UserOrganizationAck,
    type CreateLabelCommand,
    type LabelAssignmentCommand,
    type CreateCollectionCommand,
    type UpdateCollectionCommand,
    type CollectionItemCommand,
    type FavoriteCommand,
    type BoardCommandAck,
    type BoardDetail,
    type BoardList,
    type CreateBlockCommand,
    type CreateBoardCommand,
    type CreateSectionCommand,
    type MoveBlockCommand,
    type SetBlockVisibilityCommand,
    type UpdateBlockConfigCommand,
    type UpdateBoardCommand,
    type UpdateSectionCommand,
    type PinSpotlightCommand,
    type SpotlightPlacement,
    type SpotlightPlacementList,
} from "@cosmos/contracts";

export interface CosmosEventSource {
    onmessage: ((event: { data: string }) => void) | null;
    onerror: (() => void) | null;
    close(): void;
}

export interface HttpCosmosClientOptions {
    baseUrl: string;
    fetch?: typeof globalThis.fetch;
    eventSourceFactory?: (url: string) => CosmosEventSource;
}

export class CosmosTransportError extends Error {
    readonly status: number;
    readonly body: unknown;

    constructor(status: number, body: unknown) {
        super(`Cosmos service request failed with HTTP ${status}.`);
        this.name = "CosmosTransportError";
        this.status = status;
        this.body = body;
    }
}

export class HttpCosmosClient {
    private readonly baseUrl: string;
    private readonly fetcher: typeof globalThis.fetch;
    private readonly eventSourceFactory: (
        url: string,
    ) => CosmosEventSource;

    constructor(options: HttpCosmosClientOptions) {
        this.baseUrl = options.baseUrl.replace(/\/+$/, "");
        this.fetcher = (
            options.fetch ?? globalThis.fetch
        ).bind(globalThis);
        this.eventSourceFactory = options.eventSourceFactory
            ?? ((url): CosmosEventSource => {
                const EventSourceConstructor = (
                    globalThis as typeof globalThis & {
                        EventSource?: new (url: string) => CosmosEventSource;
                    }
                ).EventSource;
                if (!EventSourceConstructor) {
                    throw new Error("EventSource is not available in this runtime.");
                }
                return new EventSourceConstructor(url) as CosmosEventSource;
            });
    }

    async health(): Promise<HealthResponse> {
        return this.request("/api/v1/health", {
            schema: healthResponseSchema,
        });
    }

    async listConnectors(): Promise<readonly ConnectorDescriptor[]> {
        return this.request("/api/v1/connectors", {
            schema: connectorDescriptorSchema.array(),
        });
    }

    async listSourceDefinitions(): Promise<readonly SourceDefinitionManifest[]> {
        const page = await this.request("/api/v1/source-definitions", {
            schema: sourceDefinitionPageSchema,
        });
        return page.items;
    }

    async createSourceConfigProbe(
        input: SourceConfigProbeCommand,
        idempotencyKey?: string,
    ): Promise<SourceConfigProbeJobSnapshot> {
        const payload = sourceConfigProbeCommandSchema.parse(input);
        return this.request("/api/v1/source-config-probes", {
            method: "POST",
            headers: idempotencyKey
                ? { "idempotency-key": idempotencyKey }
                : undefined,
            body: payload,
            schema: sourceConfigProbeJobSnapshotSchema,
        });
    }

    async getSourceConfigProbe(jobId: string): Promise<SourceConfigProbeJobSnapshot> {
        return this.request(`/api/v1/source-config-probes/${encodeURIComponent(jobId)}`, {
            schema: sourceConfigProbeJobSnapshotSchema,
        });
    }

    async createMediaCleanup(
        input: MediaCleanupCommand,
        idempotencyKey: string,
    ): Promise<MediaCleanupRunSnapshot> {
        const payload = mediaCleanupCommandSchema.parse(input);
        return this.request("/api/v1/media-cleanups", {
            method: "POST",
            headers: { "idempotency-key": idempotencyKey },
            body: payload,
            schema: mediaCleanupRunSnapshotSchema,
        });
    }

    async getMediaCleanup(runId: string): Promise<MediaCleanupRunSnapshot> {
        return this.request(`/api/v1/media-cleanups/${encodeURIComponent(runId)}`, {
            schema: mediaCleanupRunSnapshotSchema,
        });
    }

    async listSources(): Promise<readonly SourceSnapshot[]> {
        return this.request("/api/v1/sources", {
            schema: sourceSnapshotSchema.array(),
        });
    }
    async getSource(sourceId: string): Promise<SourceSnapshot> {
        return this.request(`/api/v1/sources/${encodeURIComponent(sourceId)}`, {
            schema: sourceSnapshotSchema,
        });
    }

    async createSource(input: CreateSourceCommand): Promise<SourceSnapshot> {
        const payload = createSourceCommandSchema.parse(input);
        return this.request("/api/v1/sources", {
            method: "POST",
            body: payload,
            schema: sourceSnapshotSchema,
        });
    }

    async updateSource(
        sourceId: string,
        input: UpdateSourceCommand,
    ): Promise<SourceSnapshot> {
        return this.request(`/api/v1/sources/${encodeURIComponent(sourceId)}`, {
            method: "PATCH",
            body: input,
            schema: sourceSnapshotSchema,
        });
    }

    async activateSource(
        sourceId: string,
        input: SourceActivationCommand,
        idempotencyKey: string,
    ): Promise<SourceSnapshot> {
        const payload = sourceActivationCommandSchema.parse(input);
        return this.request(`/api/v1/sources/${encodeURIComponent(sourceId)}/activation-commands`, {
            method: "POST",
            headers: { "idempotency-key": idempotencyKey },
            body: payload,
            schema: sourceSnapshotSchema,
        });
    }

    async testSource(sourceId: string, idempotencyKey?: string): Promise<JobSnapshot> {
        return this.request(`/api/v1/sources/${encodeURIComponent(sourceId)}/test`, {
            method: "POST",
            headers: idempotencyKey
                ? { "idempotency-key": idempotencyKey }
                : undefined,
            schema: jobSnapshotSchema,
        });
    }

    async triggerSource(
        sourceId: string,
        options: { idempotencyKey?: string } = {},
    ): Promise<RunSnapshot> {
        return this.request(`/api/v1/sources/${encodeURIComponent(sourceId)}/runs`, {
            method: "POST",
            headers: options.idempotencyKey
                ? { "idempotency-key": options.idempotencyKey }
                : undefined,
            schema: runSnapshotSchema,
        });
    }

    async getJob(jobId: string): Promise<JobSnapshot> {
        return this.request(`/api/v1/jobs/${encodeURIComponent(jobId)}`, {
            schema: jobSnapshotSchema,
        });
    }

    async feed(options: {
        cursor?: string;
        limit?: number;
    } = {}): Promise<FeedPage> {
        const params = new URLSearchParams();
        if (options.cursor) {
            params.set("cursor", options.cursor);
        }
        if (options.limit) {
            params.set("limit", String(options.limit));
        }
        return this.request(`/api/v1/feed?${params.toString()}`, {
            schema: feedPageSchema,
        });
    }

    async search(query: SearchQuery): Promise<SearchPage> {
        const params = new URLSearchParams();
        if (query.text) {
            params.set("text", query.text);
        }
        if (query.sourceId) {
            params.set("sourceId", query.sourceId);
        }
        if (query.publishedAfter) {
            params.set("publishedAfter", query.publishedAfter);
        }
        if (query.publishedBefore) {
            params.set("publishedBefore", query.publishedBefore);
        }
        if (query.labelIds) {
            params.set("labelIds", query.labelIds);
        }
        if (query.topicIds) {
            params.set("topicIds", query.topicIds);
        }
        if (query.cursor) {
            params.set("cursor", query.cursor);
        }
        if (query.limit) {
            params.set("limit", String(query.limit));
        }
        return this.request(`/api/v1/search?${params.toString()}`, {
            schema: searchPageSchema,
        });
    }

    async story(storyId: string): Promise<StoryDetail> {
        return this.request(`/api/v1/stories/${encodeURIComponent(storyId)}`, {
            schema: storyDetailSchema,
        });
    }

    async moveEntryToStory(
        storyId: string,
        input: MoveEntryToStoryCommand,
    ): Promise<StoryDetail> {
        const payload = moveEntryToStoryCommandSchema.parse(input);
        return this.request(`/api/v1/stories/${encodeURIComponent(storyId)}/entry-moves`, {
            method: "POST",
            body: payload,
            schema: storyDetailSchema,
        });
    }

    async updateStoryRevision(
        storyId: string,
        input: UpdateStoryRevisionCommand,
    ): Promise<StoryDetail> {
        const payload = updateStoryRevisionCommandSchema.parse(input);
        return this.request(`/api/v1/stories/${encodeURIComponent(storyId)}/revisions`, {
            method: "POST",
            body: payload,
            schema: storyDetailSchema,
        });
    }

    async mergeStories(input: MergeStoriesCommand): Promise<StoryDetail> {
        const payload = mergeStoriesCommandSchema.parse(input);
        return this.request("/api/v1/stories/merges", {
            method: "POST",
            body: payload,
            schema: storyDetailSchema,
        });
    }

    async splitStory(storyId: string, input: SplitStoryCommand): Promise<StoryDetail> {
        const payload = splitStoryCommandSchema.parse(input);
        return this.request(`/api/v1/stories/${encodeURIComponent(storyId)}/splits`, {
            method: "POST",
            body: payload,
            schema: storyDetailSchema,
        });
    }

    async listStorySubtypes(query: { kind?: StorySubtype["kind"] } = {}): Promise<readonly StorySubtype[]> {
        const params = new URLSearchParams();
        if (query.kind) {
            params.set("kind", query.kind);
        }
        const page = await this.request(`/api/v1/story-subtypes?${params.toString()}`, {
            schema: storySubtypePageSchema,
        });
        return page.items;
    }

    async listTopics(query: { cursor?: string; limit?: number } = {}): Promise<TopicPage> {
        const params = new URLSearchParams();
        if (query.cursor) {
            params.set("cursor", query.cursor);
        }
        if (query.limit) {
            params.set("limit", String(query.limit));
        }
        return this.request(`/api/v1/topics?${params.toString()}`, {
            schema: topicPageSchema,
        });
    }

    async topic(topicId: string): Promise<TopicDetail> {
        return this.request(`/api/v1/topics/${encodeURIComponent(topicId)}`, {
            schema: topicDetailSchema,
        });
    }

    async createTopic(input: CreateTopicCommand): Promise<TopicDetail> {
        const payload = createTopicCommandSchema.parse(input);
        return this.request("/api/v1/topics", {
            method: "POST",
            body: payload,
            schema: topicDetailSchema,
        });
    }

    async updateTopic(topicId: string, input: UpdateTopicCommand): Promise<TopicDetail> {
        const payload = updateTopicCommandSchema.parse(input);
        return this.request(`/api/v1/topics/${encodeURIComponent(topicId)}/revisions`, {
            method: "POST",
            body: payload,
            schema: topicDetailSchema,
        });
    }

    async mergeTopics(input: MergeTopicsCommand): Promise<TopicDetail> {
        const payload = mergeTopicsCommandSchema.parse(input);
        return this.request("/api/v1/topics/merges", {
            method: "POST",
            body: payload,
            schema: topicDetailSchema,
        });
    }

    async addTopicMember(topicId: string, input: AddTopicMemberCommand): Promise<TopicDetail> {
        const payload = addTopicMemberCommandSchema.parse(input);
        return this.request(`/api/v1/topics/${encodeURIComponent(topicId)}/members`, {
            method: "POST",
            body: payload,
            schema: topicDetailSchema,
        });
    }

    async updateTopicMemberRole(
        topicId: string,
        input: UpdateTopicMemberRoleCommand,
    ): Promise<TopicDetail> {
        const payload = updateTopicMemberRoleCommandSchema.parse(input);
        return this.request(`/api/v1/topics/${encodeURIComponent(topicId)}/member-role-updates`, {
            method: "POST",
            body: payload,
            schema: topicDetailSchema,
        });
    }

    async removeTopicMember(topicId: string, input: RemoveTopicMemberCommand): Promise<TopicDetail> {
        const payload = removeTopicMemberCommandSchema.parse(input);
        return this.request(`/api/v1/topics/${encodeURIComponent(topicId)}/member-removals`, {
            method: "POST",
            body: payload,
            schema: topicDetailSchema,
        });
    }

    async restoreTopicMember(
        topicId: string,
        input: RestoreTopicMemberCommand,
    ): Promise<TopicDetail> {
        const payload = restoreTopicMemberCommandSchema.parse(input);
        return this.request(`/api/v1/topics/${encodeURIComponent(topicId)}/member-restorations`, {
            method: "POST",
            body: payload,
            schema: topicDetailSchema,
        });
    }

    async listEntities(query: { cursor?: string; limit?: number } = {}): Promise<EntityPage> {
        const params = new URLSearchParams();
        if (query.cursor) {
            params.set("cursor", query.cursor);
        }
        if (query.limit) {
            params.set("limit", String(query.limit));
        }
        return this.request(`/api/v1/entities?${params.toString()}`, {
            schema: entityPageSchema,
        });
    }

    async entity(entityId: string): Promise<EntityDetail> {
        return this.request(`/api/v1/entities/${encodeURIComponent(entityId)}`, {
            schema: entityDetailSchema,
        });
    }

    async createEntity(input: CreateEntityCommand): Promise<EntityDetail> {
        const payload = createEntityCommandSchema.parse(input);
        return this.request("/api/v1/entities", {
            method: "POST",
            body: payload,
            schema: entityDetailSchema,
        });
    }

    async updateEntity(entityId: string, input: UpdateEntityCommand): Promise<EntityDetail> {
        const payload = updateEntityCommandSchema.parse(input);
        return this.request(`/api/v1/entities/${encodeURIComponent(entityId)}/revisions`, {
            method: "POST",
            body: payload,
            schema: entityDetailSchema,
        });
    }

    async addEntityAlias(entityId: string, input: AddEntityAliasCommand): Promise<EntityDetail> {
        const payload = addEntityAliasCommandSchema.parse(input);
        return this.request(`/api/v1/entities/${encodeURIComponent(entityId)}/aliases`, {
            method: "POST",
            body: payload,
            schema: entityDetailSchema,
        });
    }

    async removeEntityAlias(entityId: string, input: RemoveEntityAliasCommand): Promise<EntityDetail> {
        const payload = removeEntityAliasCommandSchema.parse(input);
        return this.request(`/api/v1/entities/${encodeURIComponent(entityId)}/alias-removals`, {
            method: "POST",
            body: payload,
            schema: entityDetailSchema,
        });
    }

    async linkStoryEntity(input: LinkStoryEntityCommand): Promise<EntityDetail> {
        const payload = linkStoryEntityCommandSchema.parse(input);
        return this.request("/api/v1/story-entity-links", {
            method: "POST",
            body: payload,
            schema: entityDetailSchema,
        });
    }

    async unlinkStoryEntity(input: UnlinkStoryEntityCommand): Promise<EntityDetail> {
        const payload = unlinkStoryEntityCommandSchema.parse(input);
        return this.request("/api/v1/story-entity-links/removals", {
            method: "POST",
            body: payload,
            schema: entityDetailSchema,
        });
    }

    async linkEntryStory(input: LinkEntryStoryCommand): Promise<StoryDetail> {
        const payload = linkEntryStoryCommandSchema.parse(input);
        return this.request("/api/v1/entry-story-links", {
            method: "POST",
            body: payload,
            schema: storyDetailSchema,
        });
    }

    async unlinkEntryStory(input: UnlinkEntryStoryCommand): Promise<StoryDetail> {
        const payload = unlinkEntryStoryCommandSchema.parse(input);
        return this.request("/api/v1/entry-story-links/removals", {
            method: "POST",
            body: payload,
            schema: storyDetailSchema,
        });
    }

    async createEntityRelation(input: CreateEntityRelationCommand): Promise<EntityDetail> {
        const payload = createEntityRelationCommandSchema.parse(input);
        return this.request("/api/v1/entity-relations", {
            method: "POST",
            body: payload,
            schema: entityDetailSchema,
        });
    }

    async removeEntityRelation(input: RemoveEntityRelationCommand): Promise<EntityDetail> {
        const payload = removeEntityRelationCommandSchema.parse(input);
        return this.request("/api/v1/entity-relations/removals", {
            method: "POST",
            body: payload,
            schema: entityDetailSchema,
        });
    }

    async listLabels(): Promise<LabelList> {
        return this.request("/api/v1/labels", {
            schema: labelListSchema,
        });
    }

    async label(labelId: string): Promise<LabelDetail> {
        return this.request(`/api/v1/labels/${encodeURIComponent(labelId)}`, {
            schema: labelDetailSchema,
        });
    }

    async createLabel(input: CreateLabelCommand): Promise<LabelItem> {
        const payload = createLabelCommandSchema.parse(input);
        return this.request("/api/v1/labels", {
            method: "POST",
            body: payload,
            schema: labelItemSchema,
        });
    }

    async deleteLabel(labelId: string): Promise<UserOrganizationAck> {
        return this.request(`/api/v1/labels/${encodeURIComponent(labelId)}/removals`, {
            method: "POST",
            schema: userOrganizationAckSchema,
        });
    }

    async attachLabel(input: LabelAssignmentCommand): Promise<UserOrganizationAck> {
        const payload = labelAssignmentCommandSchema.parse(input);
        return this.request("/api/v1/label-assignments", {
            method: "POST",
            body: payload,
            schema: userOrganizationAckSchema,
        });
    }

    async detachLabel(input: LabelAssignmentCommand): Promise<UserOrganizationAck> {
        const payload = labelAssignmentCommandSchema.parse(input);
        return this.request("/api/v1/label-assignments/removals", {
            method: "POST",
            body: payload,
            schema: userOrganizationAckSchema,
        });
    }

    async listCollections(options: { storyId?: string } = {}): Promise<CollectionList> {
        const params = new URLSearchParams();
        if (options.storyId) {
            params.set("storyId", options.storyId);
        }
        const query = params.toString();
        return this.request(`/api/v1/collections${query ? `?${query}` : ""}`, {
            schema: collectionListSchema,
        });
    }

    async collection(collectionId: string): Promise<CollectionDetail> {
        return this.request(`/api/v1/collections/${encodeURIComponent(collectionId)}`, {
            schema: collectionDetailSchema,
        });
    }

    async createCollection(input: CreateCollectionCommand): Promise<CollectionSummary> {
        const payload = createCollectionCommandSchema.parse(input);
        return this.request("/api/v1/collections", {
            method: "POST",
            body: payload,
            schema: collectionSummarySchema,
        });
    }

    async updateCollection(
        collectionId: string,
        input: UpdateCollectionCommand,
    ): Promise<CollectionSummary> {
        const payload = updateCollectionCommandSchema.parse(input);
        return this.request(`/api/v1/collections/${encodeURIComponent(collectionId)}`, {
            method: "PATCH",
            body: payload,
            schema: collectionSummarySchema,
        });
    }

    async deleteCollection(collectionId: string): Promise<UserOrganizationAck> {
        return this.request(`/api/v1/collections/${encodeURIComponent(collectionId)}/removals`, {
            method: "POST",
            schema: userOrganizationAckSchema,
        });
    }

    async addCollectionItem(
        collectionId: string,
        input: CollectionItemCommand,
    ): Promise<UserOrganizationAck> {
        const payload = collectionItemCommandSchema.parse(input);
        return this.request(`/api/v1/collections/${encodeURIComponent(collectionId)}/items`, {
            method: "POST",
            body: payload,
            schema: userOrganizationAckSchema,
        });
    }

    async removeCollectionItem(
        collectionId: string,
        input: CollectionItemCommand,
    ): Promise<UserOrganizationAck> {
        const payload = collectionItemCommandSchema.parse(input);
        return this.request(
            `/api/v1/collections/${encodeURIComponent(collectionId)}/items/removals`,
            {
                method: "POST",
                body: payload,
                schema: userOrganizationAckSchema,
            },
        );
    }

    async listFavorites(): Promise<FavoriteList> {
        return this.request("/api/v1/favorites", {
            schema: favoriteListSchema,
        });
    }

    async setFavorite(input: FavoriteCommand): Promise<UserOrganizationAck> {
        const payload = favoriteCommandSchema.parse(input);
        return this.request("/api/v1/favorites", {
            method: "POST",
            body: payload,
            schema: userOrganizationAckSchema,
        });
    }

    async unsetFavorite(input: FavoriteCommand): Promise<UserOrganizationAck> {
        const payload = favoriteCommandSchema.parse(input);
        return this.request("/api/v1/favorites/removals", {
            method: "POST",
            body: payload,
            schema: userOrganizationAckSchema,
        });
    }

    async listAnnotations(input: {
        targetType: string;
        targetId: string;
    }): Promise<AnnotationList> {
        const params = new URLSearchParams({
            targetType: input.targetType,
            targetId: input.targetId,
        });
        return this.request(`/api/v1/annotations?${params.toString()}`, {
            schema: annotationListSchema,
        });
    }

    async createAnnotation(input: CreateAnnotationCommand): Promise<Annotation> {
        const payload = createAnnotationCommandSchema.parse(input);
        return this.request("/api/v1/annotations", {
            method: "POST",
            body: payload,
            schema: annotationSchema,
        });
    }

    async updateAnnotation(
        annotationId: string,
        input: UpdateAnnotationCommand,
    ): Promise<Annotation> {
        const payload = updateAnnotationCommandSchema.parse(input);
        return this.request(`/api/v1/annotations/${encodeURIComponent(annotationId)}`, {
            method: "PATCH",
            body: payload,
            schema: annotationSchema,
        });
    }

    async deleteAnnotation(annotationId: string): Promise<UserOrganizationAck> {
        return this.request(
            `/api/v1/annotations/${encodeURIComponent(annotationId)}/removals`,
            {
                method: "POST",
                schema: userOrganizationAckSchema,
            },
        );
    }

    async listSavedViews(): Promise<SavedViewList> {
        return this.request("/api/v1/saved-views", {
            schema: savedViewListSchema,
        });
    }

    async createSavedView(input: CreateSavedViewCommand): Promise<SavedView> {
        const payload = createSavedViewCommandSchema.parse(input);
        return this.request("/api/v1/saved-views", {
            method: "POST",
            body: payload,
            schema: savedViewSchema,
        });
    }

    async updateSavedView(
        savedViewId: string,
        input: UpdateSavedViewCommand,
    ): Promise<SavedView> {
        const payload = updateSavedViewCommandSchema.parse(input);
        return this.request(`/api/v1/saved-views/${encodeURIComponent(savedViewId)}`, {
            method: "PATCH",
            body: payload,
            schema: savedViewSchema,
        });
    }

    async deleteSavedView(savedViewId: string): Promise<UserOrganizationAck> {
        return this.request(
            `/api/v1/saved-views/${encodeURIComponent(savedViewId)}/removals`,
            {
                method: "POST",
                schema: userOrganizationAckSchema,
            },
        );
    }

    async listBoards(): Promise<BoardList> {
        return this.request("/api/v1/boards", {
            schema: boardListSchema,
        });
    }

    async getBoard(boardId: string): Promise<BoardDetail> {
        return this.request(`/api/v1/boards/${encodeURIComponent(boardId)}`, {
            schema: boardDetailSchema,
        });
    }

    async ensureDefaultBoard(): Promise<BoardDetail> {
        return this.request("/api/v1/boards/ensure-default", {
            method: "POST",
            schema: boardDetailSchema,
        });
    }

    async createBoard(input: CreateBoardCommand): Promise<BoardDetail> {
        const payload = createBoardCommandSchema.parse(input);
        return this.request("/api/v1/boards", {
            method: "POST",
            body: payload,
            schema: boardDetailSchema,
        });
    }

    async updateBoard(
        boardId: string,
        input: UpdateBoardCommand,
    ): Promise<BoardDetail> {
        const payload = updateBoardCommandSchema.parse(input);
        return this.request(`/api/v1/boards/${encodeURIComponent(boardId)}`, {
            method: "PATCH",
            body: payload,
            schema: boardDetailSchema,
        });
    }

    async deleteBoard(boardId: string): Promise<BoardCommandAck> {
        return this.request(`/api/v1/boards/${encodeURIComponent(boardId)}/removals`, {
            method: "POST",
            schema: boardCommandAckSchema,
        });
    }

    async createBoardSection(input: CreateSectionCommand): Promise<BoardDetail> {
        const payload = createSectionCommandSchema.parse(input);
        return this.request("/api/v1/board-sections", {
            method: "POST",
            body: payload,
            schema: boardDetailSchema,
        });
    }

    async updateBoardSection(
        sectionId: string,
        input: UpdateSectionCommand,
    ): Promise<BoardDetail> {
        const payload = updateSectionCommandSchema.parse(input);
        return this.request(
            `/api/v1/board-sections/${encodeURIComponent(sectionId)}`,
            {
                method: "PATCH",
                body: payload,
                schema: boardDetailSchema,
            },
        );
    }

    async deleteBoardSection(sectionId: string): Promise<BoardCommandAck> {
        return this.request(
            `/api/v1/board-sections/${encodeURIComponent(sectionId)}/removals`,
            {
                method: "POST",
                schema: boardCommandAckSchema,
            },
        );
    }

    async createBoardBlock(input: CreateBlockCommand): Promise<BoardDetail> {
        const payload = createBlockCommandSchema.parse(input);
        return this.request("/api/v1/board-blocks", {
            method: "POST",
            body: payload,
            schema: boardDetailSchema,
        });
    }

    async updateBoardBlockConfig(
        blockId: string,
        input: UpdateBlockConfigCommand,
    ): Promise<BoardDetail> {
        const payload = updateBlockConfigCommandSchema.parse(input);
        return this.request(`/api/v1/board-blocks/${encodeURIComponent(blockId)}`, {
            method: "PATCH",
            body: payload,
            schema: boardDetailSchema,
        });
    }

    async moveBoardBlock(
        blockId: string,
        input: MoveBlockCommand,
    ): Promise<BoardDetail> {
        const payload = moveBlockCommandSchema.parse(input);
        return this.request(
            `/api/v1/board-blocks/${encodeURIComponent(blockId)}/moves`,
            {
                method: "POST",
                body: payload,
                schema: boardDetailSchema,
            },
        );
    }

    async setBoardBlockVisibility(
        blockId: string,
        input: SetBlockVisibilityCommand,
    ): Promise<BoardDetail> {
        const payload = setBlockVisibilityCommandSchema.parse(input);
        return this.request(
            `/api/v1/board-blocks/${encodeURIComponent(blockId)}/visibility`,
            {
                method: "POST",
                body: payload,
                schema: boardDetailSchema,
            },
        );
    }

    async duplicateBoardBlock(blockId: string): Promise<BoardDetail> {
        return this.request(
            `/api/v1/board-blocks/${encodeURIComponent(blockId)}/duplications`,
            {
                method: "POST",
                schema: boardDetailSchema,
            },
        );
    }

    async deleteBoardBlock(blockId: string): Promise<BoardCommandAck> {
        return this.request(
            `/api/v1/board-blocks/${encodeURIComponent(blockId)}/removals`,
            {
                method: "POST",
                schema: boardCommandAckSchema,
            },
        );
    }

    async listSpotlightPlacements(query: {
        boardId?: string;
    } = {}): Promise<SpotlightPlacementList> {
        const params = new URLSearchParams();
        if (query.boardId) {
            params.set("boardId", query.boardId);
        }
        const suffix = params.toString();
        return this.request(
            `/api/v1/spotlight-placements${suffix ? `?${suffix}` : ""}`,
            { schema: spotlightPlacementListSchema },
        );
    }

    async pinSpotlight(input: PinSpotlightCommand): Promise<SpotlightPlacement> {
        const payload = pinSpotlightCommandSchema.parse(input);
        return this.request("/api/v1/spotlight-placements", {
            method: "POST",
            body: payload,
            schema: spotlightPlacementSchema,
        });
    }

    async unpinSpotlight(placementId: string): Promise<BoardCommandAck> {
        return this.request(
            `/api/v1/spotlight-placements/${encodeURIComponent(placementId)}/removals`,
            {
                method: "POST",
                schema: boardCommandAckSchema,
            },
        );
    }

    async entries(query: EntryListQuery = {}): Promise<EntryPage> {
        const params = new URLSearchParams();
        if (query.sourceId) {
            params.set("sourceId", query.sourceId);
        }
        if (query.cursor) {
            params.set("cursor", query.cursor);
        }
        if (query.limit) {
            params.set("limit", String(query.limit));
        }
        return this.request(`/api/v1/entries?${params.toString()}`, {
            schema: entryPageSchema,
        });
    }

    async entry(entryId: string): Promise<EntryDetail> {
        return this.request(`/api/v1/entries/${encodeURIComponent(entryId)}`, {
            schema: entryDetailSchema,
        });
    }

    async revision(revisionId: string): Promise<RevisionDetail> {
        return this.request(`/api/v1/revisions/${encodeURIComponent(revisionId)}`, {
            schema: revisionDetailSchema,
        });
    }

    openEventStream(options: {
        afterEventId?: string;
        onEvent: (event: SseEvent) => void;
        onError?: () => void;
    }): () => void {
        const params = new URLSearchParams();
        if (options.afterEventId) {
            params.set("after", options.afterEventId);
        }
        const query = params.toString();
        const source = this.eventSourceFactory(
            `${this.baseUrl}/api/v1/events${query ? `?${query}` : ""}`,
        );
        source.onmessage = (message) => {
            try {
                options.onEvent(sseEventSchema.parse(JSON.parse(message.data)));
            } catch {
                options.onError?.();
            }
        };
        source.onerror = () => {
            options.onError?.();
        };
        return () => source.close();
    }

    private async request<TSchema extends { parse: (value: unknown) => unknown }>(
        path: string,
        options: {
            method?: "GET" | "POST" | "PATCH";
            body?: unknown;
            headers?: Record<string, string>;
            schema: TSchema;
        },
    ): Promise<ReturnType<TSchema["parse"]>> {
        const response = await this.fetcher(`${this.baseUrl}${path}`, {
            method: options.method ?? "GET",
            headers: {
                ...(options.body ? { "content-type": "application/json" } : {}),
                ...(options.headers ?? {}),
            },
            body: options.body ? JSON.stringify(options.body) : undefined,
        });

        const body = await response.json().catch(() => null);
        if (!response.ok) {
            throw new CosmosTransportError(response.status, body);
        }

        return options.schema.parse(body) as ReturnType<TSchema["parse"]>;
    }
}
