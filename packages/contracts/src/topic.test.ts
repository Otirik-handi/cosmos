import { describe, expect, it } from "vitest";

import {
    addTopicMemberCommandSchema,
    createTopicCommandSchema,
    topicDetailSchema,
} from "./index.js";

describe("topic contracts", () => {
    it("rejects unknown member roles on write and accepts them on read", () => {
        expect(() => addTopicMemberCommandSchema.parse({
            storyId: "story-a",
            role: "not-a-role",
        })).toThrow();
        expect(() => createTopicCommandSchema.parse({
            title: "T",
            purpose: "P",
        })).not.toThrow();

        const detail = topicDetailSchema.parse({
            topic: {
                id: "topic-a",
                revisionId: "rev-t-1",
                title: "T",
                purpose: "P",
                scope: null,
            },
            members: [{
                storyId: "story-a",
                role: "future-role",
                reason: null,
                actor: null,
                revision: 1,
                removed: false,
            }],
        });
        expect(detail.members[0].role).toBe("future-role");
    });
});
