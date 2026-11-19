import "reflect-metadata";
import { Bind, Body, Catch, Controller, Get, Headers, HttpCode, HttpException, Inject, Param, Post, UseFilters,
    type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import { StoryDeepReadError, type StoryDeepReadWorkflowControl } from "@cosmos/application";
import { artifactReadSchema, deepReadGenerationRequestSchema, deepReadGenerationSchema, storyDeepReadRevisionDetailSchema } from "@cosmos/contracts";
import { z } from "zod";

export type StoryDeepReadControl = Pick<StoryDeepReadWorkflowControl,
    "enqueueStoryDeepRead" | "getDeepReadGeneration" | "getDeepReadArtifact" | "getDeepReadRevision">;
const id = z.string().trim().min(1).max(200);

@Catch()
export class StoryDeepReadExceptionFilter implements ExceptionFilter {
    catch(error: unknown, host: ArgumentsHost): void {
        const failure = failureFor(error instanceof HttpException && error.getStatus() === 400
            ? new StoryDeepReadError("validation_failed") : error);
        host.switchToHttp().getResponse<{ status(code: number): { json(body: unknown): void } }>()
            .status(failure.getStatus()).json(failure.getResponse());
    }
}
function failureFor(error: unknown): HttpException {
    const failure = error instanceof StoryDeepReadError ? error : new StoryDeepReadError("dependency_unavailable");
    const status = failure.code === "not_found" ? 404 : failure.code === "conflict" ? 409
        : failure.code === "dependency_unavailable" ? failure.retryable ? 503 : 500 : 400;
    return new HttpException({ code: failure.code, message: failure.message, retryable: status === 503 }, status);
}
function input<T>(schema: z.ZodType<T>, value: unknown): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw failureFor(new StoryDeepReadError("validation_failed"));
    return parsed.data;
}

@Controller()
@UseFilters(StoryDeepReadExceptionFilter)
export class StoryDeepReadController {
    constructor(@Inject("COSMOS_STORY_DEEP_READ_CONTROL") private readonly control: StoryDeepReadControl) {}

    @Post("stories/:storyId/deep-reads")
    @HttpCode(202)
    @Bind(Param("storyId"), Body(), Headers("idempotency-key"))
    async createStoryDeepRead(storyId: unknown, body: unknown, key: unknown) {
        const request = input(deepReadGenerationRequestSchema, body);
        return deepReadGenerationSchema.parse(await this.control.enqueueStoryDeepRead({
            ...request, storyId: input(id, storyId), idempotencyKey: input(id, key),
        }));
    }

    @Get("stories/:storyId/deep-reads/generations/:runId")
    @Bind(Param("storyId"), Param("runId"))
    async storyDeepReadGeneration(storyId: unknown, runId: unknown) {
        return deepReadGenerationSchema.parse(await this.control.getDeepReadGeneration(input(id, storyId), input(id, runId)));
    }

    @Get("stories/:storyId/deep-reads")
    @Bind(Param("storyId"))
    async storyDeepReadArtifact(storyId: unknown) {
        return artifactReadSchema.parse(await this.control.getDeepReadArtifact(input(id, storyId)));
    }

    @Get("stories/:storyId/deep-reads/revisions/:revision")
    @Bind(Param("storyId"), Param("revision"))
    async storyDeepReadRevision(storyId: unknown, revision: unknown) {
        const value = input(z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().positive().safe()), revision);
        return storyDeepReadRevisionDetailSchema.parse(await this.control.getDeepReadRevision(input(id, storyId), value));
    }
}
