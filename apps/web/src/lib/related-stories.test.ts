import {describe, expect, it} from "vitest";

import type { StoryDetail } from "@cosmos/contracts";

import {loadRelatedStories, type RelatedStoryPorts} from "./related-stories";

const baseStory: StoryDetail = {
    story: {
        id: "story:1",
        kind: "event",
        subtype: null,
        revisionId: "sr:1",
        title: "Jeff Dean 离开 Google",
        summary: null,
        status: "active",
        replacedBy: [],
    },
    entry: {
        id: "entry:1",
        sourceId: "source:1",
        sourceName: "来源 A",
        sourceKind: "rss",
        currentRevisionId: "er:1",
        metrics: null,
        revisions: [],
        observations: [],
        relatedStories: [],
    },
    entries: [],
    entities: [],
    topics: [],
    labels: [],
    favorited: false,
    evidence: [],
};

function ports(overrides: Partial<RelatedStoryPorts> = {}): RelatedStoryPorts {
    return {
        searchByLabelIds: async () => [],
        entity: async () => ({stories: []}),
        story: async (storyId) => ({story: {title: `标题 ${storyId}`}}),
        ...overrides,
    };
}

describe("loadRelatedStories", () => {
    it("lists stories sharing a label with the shared-label reason and excludes the current story", async () => {
        const related = await loadRelatedStories(
            {...baseStory, labels: [{id: "label:1", name: "开发"}]},
            ports({
                searchByLabelIds: async () => [
                    {storyId: "story:1", title: "自己"},
                    {storyId: "story:2", title: "另一个开发事件"},
                ],
            }),
        );

        expect(related).toEqual([{
            storyId: "story:2",
            title: "另一个开发事件",
            reason: "共享分类：开发",
        }]);
    });

    it("adds stories linked to the same entity and never duplicates one story", async () => {
        const related = await loadRelatedStories(
            {
                ...baseStory,
                labels: [{id: "label:1", name: "开发"}],
                entities: [{
                    entityId: "entity:1",
                    name: "Jeff Dean",
                    type: "person",
                    producer: "human",
                    producerVersion: null,
                    confidence: 1,
                    evidence: null,
                    actor: null,
                    reason: null,
                }],
            },
            ports({
                searchByLabelIds: async () => [{storyId: "story:2", title: "共享标签的 Story"}],
                entity: async () => ({stories: [{storyId: "story:2"}, {storyId: "story:3"}]}),
            }),
        );

        expect(related.map((item) => [item.storyId, item.reason])).toEqual([
            ["story:2", "共享分类：开发"],
            ["story:3", "共享实体：Jeff Dean"],
        ]);
    });

    it("caps the related list so an auxiliary panel cannot fan out without bound", async () => {
        const related = await loadRelatedStories(
            {...baseStory, labels: [{id: "label:1", name: "开发"}]},
            ports({
                searchByLabelIds: async () => Array.from({length: 20}, (_, index) => ({
                    storyId: `story:${index + 2}`,
                    title: `相关 ${index + 2}`,
                })),
            }),
        );

        expect(related).toHaveLength(5);
    });

    it("keeps the entity signal when the label lookup fails", async () => {
        const related = await loadRelatedStories(
            {
                ...baseStory,
                labels: [{id: "label:1", name: "开发"}],
                entities: [{
                    entityId: "entity:1",
                    name: "Jeff Dean",
                    type: "person",
                    producer: "human",
                    producerVersion: null,
                    confidence: 1,
                    evidence: null,
                    actor: null,
                    reason: null,
                }],
            },
            ports({
                searchByLabelIds: async () => {
                    throw new Error("search failed");
                },
                entity: async () => ({stories: [{storyId: "story:3"}]}),
            }),
        );

        expect(related).toEqual([{
            storyId: "story:3",
            title: "标题 story:3",
            reason: "共享实体：Jeff Dean",
        }]);
    });
});
