import {
    BadRequestException,
    ConflictException,
    Bind,
    Get,
    Header,
    NotFoundException,
    Param,
    Post,
    Query,
    Body,
    Headers,
    Sse,
    type MessageEvent,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Observable } from "rxjs";
import { ZodError } from "zod";
import { WorkflowHostConflictError } from "@cosmos/application";
import {
    mediaCleanupCommandSchema,
    cancelRunCommandSchema,
    recoverRunCommandSchema,
    rerunRunCommandSchema,
} from "@cosmos/contracts";
import "reflect-metadata";
import { AppControllerSources } from "./sources.js";
import { requireIdempotencyKey, runControlError, clampLimit, parseEventCursor, catalogPage, toPublicWorkflowRun } from "./internals.js";

export class AppControllerRuns extends AppControllerSources {
    @Get("runs")
    @Bind(Query("sourceId"), Query("limit"))
    async listRuns(sourceId?: string, limit?: string) {
        const envelopes = await this.requireWorkflowStore().listWorkflowRuns({
            sourceId: sourceId ?? null,
            limit: clampLimit(limit),
        });
        return envelopes.map(toPublicWorkflowRun);
    }

    @Get("runs/:runId")
    @Bind(Param("runId"))
    async run(runId: string) {
        const envelope = await this.workflowStore?.loadWorkflowEnvelope(runId);
        if (envelope) return toPublicWorkflowRun(envelope);
        const result = await this.repository.getRun(runId);
        if (!result) {
            throw new NotFoundException({
                code: "not_found",
                message: `Run not found: ${runId}`,
                retryable: false,
            });
        }
        return result;
    }

    @Get("workflow-runs/:runId")
    @Bind(Param("runId"))
    async workflowRun(runId: string) {
        return this.run(runId);
    }

    /**
     * Run control v1 (RUN-004 / ADR-0016). Cancel and recover operate on the
     * durable WorkflowRun through the Host store; re-run enqueues a fresh ingest
     * Run. Each result explains what is reused and what new side effects follow.
     */
    @Post("runs/:runId/cancellations")
    @Bind(Param("runId"), Body())
    async cancelRun(runId: string, body: unknown) {
        try {
            const parsed = cancelRunCommandSchema.parse(body ?? {});
            const envelope = await this.requireWorkflowStore().cancelWorkflowRun({
                runId,
                reason: parsed.reason ?? null,
            });
            return this.toRunControlResult("cancelled", envelope, {
                reuse: "已入库的 Observation/Entry/Revision 保留不回滚；幂等去重保证重跑不会重复。",
                sideEffects: "取消是终态：后续 Worker 写入被拒绝，不再产生新副作用。",
            });
        } catch (error) {
            runControlError(error);
        }
    }

    @Post("runs/:runId/recoveries")
    @Bind(Param("runId"), Body())
    async recoverRun(runId: string, body: unknown) {
        try {
            recoverRunCommandSchema.parse(body ?? {});
            const envelope = await this.requireWorkflowStore().recoverWorkflowRun({ runId });
            return this.toRunControlResult("recovered", envelope, {
                reuse: "复用已持久化的进度：从最后一个安全步骤续跑，不从头重来。",
                sideEffects: "恢复后 Worker 重新认领并继续执行后续步骤（Kernel rerun）。",
            });
        } catch (error) {
            runControlError(error);
        }
    }

    @Post("runs/:runId/re-runs")
    @Bind(Param("runId"), Body(), Headers("idempotency-key"))
    async rerunRun(runId: string, body: unknown, idempotencyKey?: string) {
        try {
            rerunRunCommandSchema.parse(body ?? {});
            if (!this.workflowControl) {
                throw new ConflictException({
                    code: "conflict",
                    message: "The durable workflow host is not enabled.",
                    retryable: false,
                });
            }
            const providedKey = idempotencyKey === undefined ? undefined : requireIdempotencyKey(idempotencyKey);
            const key = providedKey ?? `rerun:${runId}:${randomUUID()}`;
            const envelope = await this.workflowControl.rerun({ runId, idempotencyKey: key });
            return this.toRunControlResult("rerun", envelope, {
                reuse: "复用已入库内容（按 external key 幂等去重），不重复写 Observation/Entry。",
                sideEffects: "从来源当前 checkpoint 重新 fetch + ingest，产生一个全新的 Run。",
            });
        } catch (error) {
            runControlError(error);
        }
    }

    /**
     * Explicit retention cleanup (ADR-0015 decision 7). The Run always runs in
     * the Worker; `dryRun` defaults to true so a preview never deletes anything.
     */
    @Post("media-cleanups")
    @Bind(Body(), Headers("idempotency-key"))
    async createMediaCleanup(body: unknown, idempotencyKey?: string) {
        if (!this.mediaCleanupControl) {
            throw new ConflictException({
                code: "conflict",
                message: "The durable workflow host is not enabled.",
                retryable: false,
            });
        }
        try {
            const command = mediaCleanupCommandSchema.parse(body ?? {});
            const providedKey = idempotencyKey === undefined
                ? undefined
                : requireIdempotencyKey(idempotencyKey);
            const key = providedKey ?? `media-cleanup:${randomUUID()}`;
            const envelope = await this.mediaCleanupControl.enqueue({
                sourceId: command.sourceId ?? null,
                dryRun: command.dryRun ?? true,
                idempotencyKey: key,
            });
            return this.toMediaCleanupSnapshot(envelope);
        } catch (error) {
            if (error instanceof WorkflowHostConflictError) {
                throw new ConflictException({
                    code: "conflict",
                    message: error.message,
                    retryable: false,
                });
            }
            if (error instanceof ZodError) {
                throw new BadRequestException({
                    code: "validation_failed",
                    message: error.message,
                    retryable: false,
                });
            }
            throw error;
        }
    }

    @Get("media-cleanups/:runId")
    @Bind(Param("runId"))
    async mediaCleanup(runId: string) {
        const envelope = await this.workflowStore?.loadWorkflowEnvelope(runId);
        if (!envelope) {
            throw new NotFoundException({
                code: "not_found",
                message: `Media cleanup run not found: ${runId}`,
                retryable: false,
            });
        }
        return this.toMediaCleanupSnapshot(envelope);
    }

    @Get("jobs/:jobId")
    @Bind(Param("jobId"))
    async job(jobId: string) {
        const result = await this.repository.getJob(jobId);
        if (!result) {
            throw new NotFoundException({
                code: "not_found",
                message: `Job not found: ${jobId}`,
                retryable: false,
            });
        }
        return result;
    }

    @Get("jobs/:jobId/attempts")
    @Bind(Param("jobId"))
    async attempts(jobId: string) {
        return catalogPage(await this.repository.listWorkflowAttempts(jobId));
    }

    @Get("attempts/:attemptId")
    @Bind(Param("attemptId"))
    async attempt(attemptId: string) {
        const result = await this.repository.getWorkflowAttempt(attemptId);
        if (!result) {
            throw new NotFoundException({
                code: "not_found",
                message: `Attempt not found: ${attemptId}`,
                retryable: false,
            });
        }
        return result;
    }

    @Sse("events")
    @Header("Cache-Control", "no-cache")
    @Header("Connection", "keep-alive")
    events(
        @Headers("last-event-id") lastEventId?: string,
        @Query("after") after?: string,
    ): Observable<MessageEvent> {
        let cursor = parseEventCursor(lastEventId ?? after);
        const replayLimit = Math.min(
            Math.max(
                Number.parseInt(
                    process.env.COSMOS_SSE_REPLAY_LIMIT ?? "100",
                    10,
                ),
                1,
            ),
            1_000,
        );

        return new Observable<MessageEvent>((subscriber) => {
            let closed = false;
            let running = false;
            let lastKeepAliveAt = 0;

            const poll = async (): Promise<void> => {
                if (closed || running) {
                    return;
                }
                running = true;
                try {
                    const events = await this.repository.events({
                        afterSequence: cursor,
                        limit: replayLimit + 1,
                    });
                    if (events.length > replayLimit) {
                        const latestEventId = String(
                            await this.repository.latestEventSequence(),
                        );
                        cursor = Number.parseInt(latestEventId, 10);
                        subscriber.next({
                            id: latestEventId,
                            type: "message",
                            data: JSON.stringify({
                                id: latestEventId,
                                type: "snapshot_required",
                                version: "v1",
                                occurredAt: new Date().toISOString(),
                                payload: {
                                    reason: "replay_limit",
                                    latestEventId,
                                },
                            }),
                        });
                    } else {
                        for (const event of events) {
                            cursor = Number.parseInt(event.id, 10);
                            subscriber.next({
                                id: event.id,
                                type: "message",
                                data: JSON.stringify(event),
                            });
                        }
                        if (
                            events.length === 0
                            && Date.now() - lastKeepAliveAt >= 10_000
                        ) {
                            lastKeepAliveAt = Date.now();
                            subscriber.next({
                                id: String(cursor),
                                type: "message",
                                data: JSON.stringify({
                                    id: String(cursor),
                                    type: "keepalive.v1",
                                    version: "v1",
                                    occurredAt: new Date().toISOString(),
                                    payload: {},
                                }),
                            });
                        }
                    }
                } catch (error) {
                    subscriber.error(error);
                } finally {
                    running = false;
                }
            };

            void poll();
            const timer = setInterval(() => {
                void poll();
            }, 500);

            return () => {
                closed = true;
                clearInterval(timer);
            };
        });
    }
}
