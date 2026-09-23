/**
 * 包入口:只做导出与模块地图,不放实现。
 * 公共面由 `entry-surface.txt` 冻结、`entry-contract.test.ts` 看守;改导出前先看 `MODULE.md`。
 */

export {
    ActionExecutionError, ActionRegistry, type ActionExecutionContext,
    type HostActionExecutionFence, type HostActionExecutionContext, type ActionHandler,
    type HostActionHandler, type RegisteredAction,
} from "./action.js";
export {
    StaticCatalog, createBuiltinManifestCatalog, type ManifestHash, type JsonSchemaRef,
    type SourceOperationManifest, type SourceAuthManifest, type SourceDefinitionManifest,
    type WorkflowDefinitionManifest, type ActionDefinitionManifest, type CatalogPort,
} from "./catalog.js";
export {
    mediaDownloadCapability, mediaAcquisitionDefaults, mediaRetryDefaults,
    resolveMediaPolicy, acquireItemsSkippingUnchanged, parseAllowedHosts,
    createMediaAcquirer, isPublicAddress, type MediaAcquisitionLimits, type MediaPolicy,
    type HostResolver, type MediaAcquirerOptions, type MediaAcquisitionContext,
    type MediaAcquirer, type MediaRetryCandidate, type MediaRetryOutcome,
    type MediaRetryContext, type MediaRetrier,
} from "./media-acquisition.js";
export {
    WorkflowHostError, WorkflowHostConflictError, type WorkflowRunStatus,
    type WorkflowJobStatus, type WorkflowCompletionStatus, type WorkflowActivityJobKind,
    type WorkflowActionReference, type CreateWorkflowEnvelopeInput, type WorkflowEnvelope,
    type WorkflowRunLease, type WorkflowRunClaimPurpose, type ClaimWorkflowRunInput,
    type HeartbeatWorkflowRunInput, type ReleaseWorkflowRunInput,
    type WorkflowRunLeasePort, type WorkflowActivityJobPayload, type WorkflowActivityJob,
    type WorkflowActivityJobClaim, type WorkflowRuntimeAttempt, type ClaimActivityJobInput,
    type HeartbeatActivityJobInput, type ReleaseActivityJobInput, type ActivityJobLease,
    type ActivityJobTerminalResult, type CompleteActivityInput,
    type CompleteActivityResult, type WorkflowActivityJobPort, type WorkflowCompletion,
    type WorkflowCompletionClaim, type ClaimWorkflowCompletionInput,
    type HeartbeatWorkflowCompletionInput, type DeliverWorkflowCompletionInput,
    type RequeueWorkflowCompletionInput, type DeadLetterWorkflowCompletionInput,
    type WorkflowCompletionPort, type MarkResumeRequiredInput, type FailWorkflowRunInput,
    type CancelWorkflowRunInput, type RecoverWorkflowRunInput, type RecoveryRunsInput,
    type ListWorkflowRunsInput, type WorkflowHostStore, type WorkflowHostOptions,
    type WorkflowHostErrorCode,
} from "./workflow-host.js";
export {
    FixedRunIdGenerator, WorkflowRunLane, WorkflowActivityWorker,
    WorkflowCompletionDispatcher, type WorkflowRunnerLike, type WorkflowRunnerFactory,
    type WorkflowRuntimeDependencies, type WorkflowLeaseRuntimeOptions,
    type WorkflowRunLaneOptions, type WorkflowActivityWorkerOptions,
    type WorkflowCompletionDispatcherOptions, type WorkflowRunLaneResult,
    type WorkflowActivityWorkerResult, type WorkflowCompletionDispatcherResult,
} from "./workflow-host-runtime.js";
export {
    type SecretStorePort,
} from "./secret-store.js";
export {
    ConnectorStateConflictError, type ConnectorStateEntry,
    type ConnectorStateNamespaceRegistration, type ConnectorStateOwner,
    type ConnectorStateStorePort,
} from "./connector-state-store.js";

export {
    type PersistIngestItemResult, type MediaCleanupCandidate, type WorkflowAttemptSnapshot,
    type RepositoryHealth,
} from "./result-types.js";
export {
    type LoggerContext, type LoggerPort,
} from "./logger.js";
export {
    SourceNotFoundError, SourceRevisionConflictError, ConnectionNotFoundError,
    CollectionPlanNotFoundError, CollectionPlanRevisionConflictError,
    ConnectorStateImportRejectedError,
    StoryNotFoundError, StoryRevisionConflictError, StoryMergeConflictError,
    StorySplitConflictError, StorySubtypeInvalidError, StoryUserStateMigrationConflictError,
    TopicNotFoundError,
    TopicRevisionConflictError, TopicMergeConflictError, TopicMembershipNotFoundError,
    EntityNotFoundError, EntityRevisionConflictError, EntityRelationConflictError,
    EntityAliasConflictError, LabelNotFoundError, LabelConflictError,
    CollectionNotFoundError, EntryNotFoundError, EntryStoryLinkConflictError,
    EntryRelationConflictError,
    AnnotationNotFoundError, SavedViewNotFoundError, BoardNotFoundError,
    BoardNameConflictError, BoardSectionNotFoundError, BoardBlockNotFoundError,
    SpotlightPlacementNotFoundError,
} from "./errors.js";
export {
    type EntityLinkProvenanceInput, type CosmosRepository,
    type CollectionPlanWebhookEntryTarget,
} from "./repository-port.js";
export {
    ConnectorExecutionError, type JobLease, type IngestConnector, type ConnectorErrorCode,
    type ConnectorResolver, type ConnectorStateHandle,
} from "./connector-ports.js";
export {
    ConnectorRegistry,
} from "./connector-registry.js";
export {
    ConnectorProbeService, SourceConfigProbeService,
} from "./connector-probe.js";
export {
    ConnectionProbeService,
} from "./connection-probe.js";
export {
    IngestionService, type IngestionWorkerOptions, type WorkerJobResult,
} from "./ingestion-service.js";
export {
    IngestionWorker,
} from "./ingestion-worker.js";
export {
    createHealthSnapshot,
} from "./health.js";
