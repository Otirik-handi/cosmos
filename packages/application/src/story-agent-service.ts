import type { AgentInvocationContext } from "./agent-invocation.js";
import type { StoryAgent, StoryAgentHost, StoryAgentRequest } from "./story-agent.js";
import type { StoryAgentCandidateRecord, StoryAgentCandidates } from "./story-agent-candidates.js";

/** Only validated proposals reach persistence; formal writes require a separate human decision. */
export class StoryAgentService {
    constructor(
        private readonly agent: StoryAgent,
        private readonly candidates: StoryAgentCandidates,
        private readonly host: StoryAgentHost,
    ) {}

    async propose(request: StoryAgentRequest, context: AgentInvocationContext): Promise<StoryAgentCandidateRecord> {
        const candidate = await this.agent.propose(request, this.host, context);
        if (context.signal.aborted) throw context.signal.reason ?? new Error("Story Agent request cancelled");
        return this.candidates.save(candidate);
    }
}
