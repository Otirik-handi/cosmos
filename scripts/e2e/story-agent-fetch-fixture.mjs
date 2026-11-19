import { z } from "zod";

const originalFetch = globalThis.fetch;
const requestSchema = z.object({
    model: z.string().min(1),
    messages: z.array(z.object({ role: z.string(), content: z.string().nullable().optional() }).passthrough()),
}).passthrough();
let calls = 0;

// Only the isolated browser Worker's preload owns this reserved origin; production configuration and URL policy stay unchanged.
globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.origin !== "https://story-agent.e2e.invalid") return originalFetch(input, init);
    const request = new Request(input, init);
    if (url.pathname !== "/v1/chat/completions" || request.method !== "POST"
        || request.headers.get("authorization") !== "Bearer e2e-synthetic-key") {
        return Response.json({ error: { message: "Synthetic fixture request rejected" } }, { status: 400 });
    }
    const body = requestSchema.parse(await request.json());
    const system = body.messages.find((message) => message.role === "system")?.content ?? "";
    const user = body.messages.find((message) => message.role === "user");
    const userContent = user?.content ?? "null";
    const parsed = JSON.parse(userContent);
    calls += 1;
    let responseText;
    if (system.includes('"headline"') && system.includes('Only cite supplied source identities')) {
        const mode = body.model.endsWith("-hold") ? "hold" : body.model.endsWith("-fail") ? "fail" : "normal";
        if (mode === "hold") await new Promise(() => {});
        if (mode === "fail") throw new Error("Synthetic deep-read failure");
        const data = z.object({ sources: z.array(z.object({ entryId: z.string(), entryRevisionId: z.string(), representationVersion: z.number(), blocks: z.array(z.object({ id: z.string(), text: z.string() })) })) }).passthrough().parse(parsed);
        const source = data.sources.find((item) => item.blocks.length > 0);
        if (!source) throw new Error("Deep-read fixture prompt has no usable evidence block");
        const block = source.blocks[0];
        if (!block) throw new Error("Deep-read fixture source has no evidence block");
        const report = {
            headline: "Synthetic deep-read report",
            sections: [
                { heading: "Reported source fact", kind: "fact", blocks: [{ type: "paragraph", data: { inlines: [{ type: "text", text: `The source states: ${block.text}` }] } }], evidence: [{ entryId: source.entryId, entryRevisionId: source.entryRevisionId, representationVersion: source.representationVersion, blockId: block.id }] },
                { heading: "Agent viewpoint", kind: "opinion", blocks: [{ type: "paragraph", data: { inlines: [{ type: "text", text: "This synthetic perspective is separate from the source fact." }] } }], evidence: [] },
            ],
        };
        const strictReport = z.object({ headline: z.string(), sections: z.array(z.object({ heading: z.string(), kind: z.enum(["fact", "opinion"]), blocks: z.array(z.unknown()), evidence: z.array(z.object({ entryId: z.string(), entryRevisionId: z.string(), representationVersion: z.number(), blockId: z.string().optional() }).strict()) }).strict()) }).strict().parse(report);
        const allowedSources = new Map(data.sources.map((item) => [item.entryRevisionId, item]));
        for (const section of strictReport.sections) {
            for (const reference of section.evidence) {
                const allowed = allowedSources.get(reference.entryRevisionId);
                if (!allowed || allowed.entryId !== reference.entryId || allowed.representationVersion !== reference.representationVersion
                    || (reference.blockId !== undefined && !allowed.blocks.some((item) => item.id === reference.blockId))) {
                    throw new Error("Deep-read fixture cited evidence outside the prompt allowlist");
                }
            }
        }
        if (!strictReport.sections[0]?.evidence[0] || strictReport.sections[0].evidence[0].blockId !== block.id) throw new Error("Deep-read fixture evidence was not allowlisted");
        responseText = JSON.stringify(report);
    } else {
        const prompt = z.object({ task: z.literal("story.summarize") }).passthrough().parse(parsed);
        responseText = JSON.stringify({ task: prompt.task, title: `Synthetic generated title ${calls}`,
            summary: `Isolated model summary ${calls}`, keyFacts: [] });
    }
    const chunk = (delta, finishReason, usage) => ({ id: `chatcmpl-synthetic-${calls}`, object: "chat.completion.chunk",
        created: 1_793_000_000, model: body.model, choices: [{ index: 0, delta, finish_reason: finishReason }],
        ...(usage ? { usage } : {}) });
    const usage = body.model === "synthetic-story-model"
        ? { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30,
            prompt_tokens_details: { cached_tokens: 0 } }
        : { prompt_tokens: body.model === "synthetic-story-model-at-threshold" ? 272000 : 272001,
            completion_tokens: 1,
            total_tokens: body.model === "synthetic-story-model-at-threshold" ? 272001 : 272002,
            prompt_tokens_details: { cached_tokens: 1 } };
    const events = [chunk({ role: "assistant", content: responseText }, null), chunk({}, "stop", usage)];
    return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", {
        headers: { "content-type": "text/event-stream" },
    });
};
