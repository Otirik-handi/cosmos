import { DeferredActivityCompletionConflictError, DeferredActivityLateCompletionError, DeferredActivityNotFoundError, NonJsonValueError, UuidIdGenerator, WorkflowBackendConflictError, WorkflowRunNotFoundError, WorkflowRunner } from "@notnotype/nb-workflow";
import type { ActivityExecutionRequest, AnyWorkflowDefinition, DeferredActivityCompletionInput, DeferredActivityExecutor, DefinitionRegistry, EventSink, EventSinkRequest, IdGenerator, JsonValue, RunView, ValueStore, WorkflowBackend, WorkflowDefinitionReference, WorkflowRunState, WorkflowRunnerOptions as KernelWorkflowRunnerOptions, WorkflowStartOptions } from "@notnotype/nb-workflow";
import type { LoggerPort } from "./logger.js";
import { WorkflowHostError } from "./workflow-host.js";
import type { ActivityJobLease, ActivityJobTerminalResult, CompleteActivityResult, WorkflowActivityJobClaim, WorkflowCompletionClaim, WorkflowEnvelope, WorkflowHostStore, WorkflowRunLease, WorkflowRuntimeAttempt } from "./workflow-host.js";
import { abortRunner, createHeartbeat, raceWithLease } from "./workflow-action-support.js";
import { FixedRunIdGenerator } from "./workflow-host-runtime-types.js";
import { createRunner, errorMessage, eventsForLease, formatReference, heartbeatMsFor, initialRunClock, isLeaseLostError, isTerminalRunStatus, leaseLostError, leaseMsFor, loggerFor, nowFor, ownerFor, resolveDefinition } from "./workflow-runtime-support.js";
import type { WorkflowRunLaneOptions, WorkflowRunLaneResult, WorkflowRunnerLike } from "./workflow-host-runtime-types.js";

/**
 * Run lane: claims one durable Run, executes begin/rerun under its fence, and
 * releases the fence when Kernel execution reaches waiting or a terminal state.
 */
export class WorkflowRunLane {
    private readonly store: WorkflowHostStore;
    private readonly owner: string;
    private readonly leaseMs: number;
    private readonly heartbeatMs: number;
    private readonly logger: LoggerPort;
    private readonly active = new Map<AbortController, { runId: string; runner?: WorkflowRunnerLike }>();

    constructor(private readonly options: WorkflowRunLaneOptions) {
        this.store = options.store;
        this.owner = ownerFor(options);
        this.leaseMs = leaseMsFor(options);
        this.heartbeatMs = heartbeatMsFor(options, this.leaseMs);
        this.logger = loggerFor(options.logger);
    }

    abortActive(reason: unknown): void {
        for (const [controller, active] of this.active) {
            if (controller.signal.aborted) continue;
            controller.abort(reason);
            abortRunner(active.runner, active.runId, controller.signal, this.logger);
        }
    }

    async pollOnce(input: { runId?: string } = {}): Promise<WorkflowRunLaneResult> {
        const lease = await this.store.claimRun({
            owner: this.owner,
            leaseMs: this.leaseMs,
            purpose: "execution",
            ...(input.runId === undefined ? {} : { runId: input.runId }),
            now: nowFor(this.options),
        });
        if (!lease) return null;

        const runLogger = this.logger.child({ runId: lease.runId });
        const controller = new AbortController();
        const active = { runId: lease.runId } as { runId: string; runner?: WorkflowRunnerLike };
        this.active.set(controller, active);
        let runner: WorkflowRunnerLike | undefined;
        const heartbeat = createHeartbeat(
            this.heartbeatMs,
            async () => this.store.heartbeatRun({
                ...lease,
                leaseMs: this.leaseMs,
                now: nowFor(this.options),
            }),
            () => {
                controller.abort(leaseLostError("Run", lease.runId));
                abortRunner(runner, lease.runId, controller.signal, runLogger);
            },
        );
        try {
            const envelope = await this.loadEnvelope(lease.runId);
            const definition = resolveDefinition(this.options, envelope);
            runner = createRunner(
                this.options,
                new FixedRunIdGenerator(lease.runId),
                lease,
                envelope.createdAt,
            );
            active.runner = runner;
            const hasKernelState = await this.store.hasWorkflowKernelState(lease.runId);
            const execution = !hasKernelState
                ? this.begin(runner, definition, envelope, controller.signal)
                : this.rerun(runner, lease.runId, controller.signal);
            const view = await raceWithLease(
                execution,
                heartbeat.lost,
                leaseLostError("Run", lease.runId),
                controller.signal,
            );
            if (isTerminalRunStatus(view.status)) {
                runLogger.debug("workflow_run_execution_finished", { status: view.status });
            }
            return view;
        } catch (error) {
            if (heartbeat.wasLost || isLeaseLostError(error)) {
                runLogger.warn("workflow_run_lease_lost", { error: errorMessage(error) });
            } else if (controller.signal.aborted) {
                runLogger.info("workflow_run_shutdown_aborted", { error: errorMessage(error) });
            }
            throw error;
        } finally {
            this.active.delete(controller);
            await heartbeat.stop();
            await this.store.releaseRun({ ...lease, now: nowFor(this.options) }).catch((error) => {
                runLogger.warn("workflow_run_release_failed", { error: errorMessage(error) });
            });
        }
    }

    private async loadEnvelope(runId: string): Promise<WorkflowEnvelope> {
        const envelope = await this.store.loadWorkflowEnvelope(runId);
        if (!envelope) {
            throw new WorkflowHostError(
                "not_found",
                `Workflow envelope ${runId} was not found after its Run lease was claimed.`,
            );
        }
        return envelope;
    }

    private begin(
        runner: WorkflowRunnerLike,
        definition: AnyWorkflowDefinition,
        envelope: WorkflowEnvelope,
        signal: AbortSignal,
    ): Promise<RunView> {
        const started = runner.begin(definition, envelope.inputSnapshot, { signal });
        return started.done;
    }

    private rerun(
        runner: WorkflowRunnerLike,
        runId: string,
        _signal: AbortSignal,
    ): Promise<RunView> {
        return runner.rerun(runId);
    }
}
