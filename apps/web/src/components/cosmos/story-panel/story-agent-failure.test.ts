import { storyAgentGenerationSchema } from "@cosmos/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { StoryAgentFailure, StoryAgentGenerationNotice } from "./story-agent-failure";

function renderFailure(errorCode: unknown) {
    return renderToStaticMarkup(createElement(StoryAgentFailure, {
        errorCode,
        canRecover: true,
        recovering: false,
        onRecover: vi.fn(),
    }));
}

describe("StoryAgentFailure", () => {
    it("renders safe timeout guidance, settings destination and a recovery action", () => {
        const html = renderFailure("timeout");
        expect(html).toContain('role="alert"');
        expect(html).toContain("允许时限");
        expect(html).not.toContain("420 秒");
        expect(html).toContain('href="/settings#story-agent-settings"');
        expect(html).toContain("重新读取任务状态");
    });

    it("renders cancellation as a status instead of an error alert", () => {
        const generation = storyAgentGenerationSchema.parse({
            runId: "run-1", storyId: "story-1", task: "story.summarize", status: "cancelled",
            candidateId: null, errorCode: null,
        });
        const html = renderToStaticMarkup(createElement(StoryAgentGenerationNotice, {
            generation, canRecover: false, recovering: false, onRecover: vi.fn(),
        }));
        expect(html).toContain('role="status"');
        expect(html).toContain("已取消");
        expect(html).not.toContain('role="alert"');
    });

    it("hides unknown server detail behind safe generic copy", () => {
        const html = renderFailure("provider_secret_internal_dump");
        expect(html).toContain("生成未能完成，请检查设置或稍后重试。");
        expect(html).not.toContain("provider_secret_internal_dump");
    });

    it("shows the caller's recovery message instead of the generic failure copy", () => {
        const html = renderToStaticMarkup(createElement(StoryAgentFailure, {
            errorCode: null,
            message: "尚未确认入队结果。请恢复同一请求；不要新建重复请求。",
            canRecover: true,
            recovering: false,
            onRecover: vi.fn(),
        }));
        expect(html).toContain("尚未确认入队结果");
        expect(html).not.toContain("生成未能完成，请检查设置或稍后重试。");
        expect(html).toContain("重新读取任务状态");
    });
});
