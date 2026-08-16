import {
    MemoryDefinitionRegistry,
    type AnyWorkflowDefinition,
} from "@notnotype/nb-workflow";
import type { PrismaClient } from "@prisma/client";
import {
    ActionRegistry,
    WorkflowActivityWorker,
    WorkflowCompletionDispatcher,
    WorkflowRunLane,
    type LoggerPort,
    type RegisteredAction,
    type WorkflowActivityWorkerOptions,
    type WorkflowCompletionDispatcherOptions,
    type WorkflowRunLaneOptions,
} from "@cosmos/application";
import {
    BlobWorkflowValueStore,
    FileBlobStore,
} from "@cosmos/blob-store";
import {
    PrismaWorkflowBackend,
    PrismaWorkflowEventSink,
    PrismaWorkflowHostStore,
} from "@cosmos/storage-prisma";

export interface WorkflowHostCompositionOptions {
    prisma: PrismaClient;
    blobs: FileBlobStore;
    definitions: readonly AnyWorkflowDefinition[];
    actions: readonly RegisteredAction[];
    owner?: string;
    workerId?: string;
    leaseMs?: number;
    runLeaseMs?: number;
    heartbeatMs?: number;
    heartbeatIntervalMs?: number;
    logger?: LoggerPort;
    now?: () => Date;
}

export interface WorkflowHostComposition {
    backend: PrismaWorkflowBackend;
    store: PrismaWorkflowHostStore;
    values: BlobWorkflowValueStore;
    events: PrismaWorkflowEventSink;
    definitions: MemoryDefinitionRegistry;
    actions: ActionRegistry;
    runLane: WorkflowRunLane;
    activityWorker: WorkflowActivityWorker;
    completionDispatcher: WorkflowCompletionDispatcher;
}

const EMPTY_CATALOG_MESSAGE =
    "COSMOS_WORKFLOW_HOST_ENABLED is reserved until this Worker registers its executable "
    + "Workflow definitions and Actions; refusing to start an empty durable host.";

export function createWorkflowHost(
    options: WorkflowHostCompositionOptions,
): WorkflowHostComposition {
    if (options.definitions.length === 0 || options.actions.length === 0) {
        throw new Error(EMPTY_CATALOG_MESSAGE);
    }

    const backend = new PrismaWorkflowBackend(options.prisma);
    const values = new BlobWorkflowValueStore(options.blobs);
    const events = new PrismaWorkflowEventSink(options.prisma);
    const definitions = new MemoryDefinitionRegistry(options.definitions);
    const actions = new ActionRegistry(options.actions);
    const actionRetryPolicies = Object.fromEntries(
        actions.descriptors().flatMap((descriptor) => descriptor.retryPolicy === null
            ? []
            : [[descriptor.ref, descriptor.retryPolicy] as const]),
    );
    const store = new PrismaWorkflowHostStore(options.prisma, {
        logger: options.logger,
        actionRetryPolicies,
    });
    const laneOptions = {
        store,
        backend,
        definitions,
        values,
        events,
        owner: options.owner,
        workerId: options.workerId,
        leaseMs: options.leaseMs,
        runLeaseMs: options.runLeaseMs,
        heartbeatMs: options.heartbeatMs,
        heartbeatIntervalMs: options.heartbeatIntervalMs,
        logger: options.logger,
        now: options.now,
    } satisfies WorkflowRunLaneOptions;
    const activityOptions = {
        ...laneOptions,
        actions,
    } satisfies WorkflowActivityWorkerOptions;
    const completionOptions = laneOptions satisfies WorkflowCompletionDispatcherOptions;

    return {
        backend,
        store,
        values,
        events,
        definitions,
        actions,
        runLane: new WorkflowRunLane(laneOptions),
        activityWorker: new WorkflowActivityWorker(activityOptions),
        completionDispatcher: new WorkflowCompletionDispatcher(completionOptions),
    };
}
