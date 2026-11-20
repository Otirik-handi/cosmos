import type { PrismaClient } from "@prisma/client";

const publicFailureCodes = new Set([
    "timeout", "authentication_required", "rate_limited", "budget_exhausted",
    "invalid_configuration", "dependency_unavailable", "malformed_payload",
]);

export class PrismaStoryAgentFailureCodeReader {
    constructor(private readonly prisma: PrismaClient) {}

    async getStoryAgentFailureCode(runId: string, definitionKey = "cosmos.story-agent"): Promise<string | null> {
        const job = await this.prisma.job.findFirst({
            where: { workflowRunId: runId, kind: "workflow-activity", status: "failed_terminal",
                workflowRun: { definitionKey } },
            select: { errorCode: true },
            orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        });
        return job?.errorCode && publicFailureCodes.has(job.errorCode) ? job.errorCode : null;
    }
}
