import {
    describe,
    expect,
    it,
    vi,
} from "vitest";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import {
    EntryNotFoundError,
    EntryRelationConflictError,
} from "@cosmos/application";
import { AppController } from "./app.controller.js";

describe("AppController entry relations", () => {
    function entryDetailFixture(entryId: string, counterpartId: string) {
        return {
            id: entryId,
            sourceId: "source-a",
            sourceName: "Source A",
            sourceKind: "rss",
            currentRevisionId: "er-a-1",
            metrics: null,
            revisions: [],
            observations: [],
            relatedStories: [],
            relations: [{
                entryId: counterpartId,
                relationType: "syndicated_from",
                direction: "outgoing",
                title: counterpartId,
                sourceId: "source-b",
                sourceName: "Source B",
                producer: "human",
                producerVersion: null,
                confidence: 1,
                evidence: null,
                actor: "user",
                reason: null,
            }],
        };
    }

    function createController(repository: Record<string, unknown>) {
        return new AppController(
            repository as never,
            {} as never,
            undefined,
            {} as never,
        );
    }

    it("passes the command through and returns the EntryDetail with its direction", async () => {
        const repository = {
            linkEntryRelation: vi.fn().mockResolvedValue(entryDetailFixture("entry-b", "entry-a")),
        };
        const result = await createController(repository).linkEntryRelation({
            fromEntryId: "entry-b",
            toEntryId: "entry-a",
            relationType: "syndicated_from",
            evidence: "原文链接一致",
            actor: "user",
            reason: "门户转载官网",
        });

        expect(result?.relations[0]).toMatchObject({
            entryId: "entry-a",
            relationType: "syndicated_from",
            direction: "outgoing",
        });
        expect(repository.linkEntryRelation).toHaveBeenCalledWith({
            fromEntryId: "entry-b",
            toEntryId: "entry-a",
            relationType: "syndicated_from",
            producer: null,
            producerVersion: null,
            confidence: null,
            evidence: "原文链接一致",
            actor: "user",
            reason: "门户转载官网",
        });
    });

    it("maps conflicts to 409, missing endpoints to 404 and malformed commands to 400", async () => {
        await expect(createController({
            linkEntryRelation: vi.fn().mockRejectedValue(
                new EntryRelationConflictError("Entry entry-a and entry-b already have the opposite direction"),
            ),
        }).linkEntryRelation({
            fromEntryId: "entry-a",
            toEntryId: "entry-b",
            relationType: "syndicated_from",
        })).rejects.toBeInstanceOf(ConflictException);

        await expect(createController({
            linkEntryRelation: vi.fn().mockRejectedValue(new EntryNotFoundError("entry-missing")),
        }).linkEntryRelation({
            fromEntryId: "entry-a",
            toEntryId: "entry-missing",
            relationType: "duplicate_of",
        })).rejects.toBeInstanceOf(NotFoundException);

        // An unknown relation word never reaches storage.
        await expect(createController({}).linkEntryRelation({
            fromEntryId: "entry-a",
            toEntryId: "entry-b",
            relationType: "same_event",
        })).rejects.toBeInstanceOf(BadRequestException);
    });

    it("removes a relation and keeps the removal idempotent", async () => {
        const repository = {
            unlinkEntryRelation: vi.fn().mockResolvedValue(entryDetailFixture("entry-a", "entry-b")),
        };
        await expect(createController(repository).unlinkEntryRelation({
            fromEntryId: "entry-b",
            toEntryId: "entry-a",
            actor: "user",
        })).resolves.toMatchObject({ id: "entry-a" });
        expect(repository.unlinkEntryRelation).toHaveBeenCalledWith({
            fromEntryId: "entry-b",
            toEntryId: "entry-a",
            actor: "user",
            reason: null,
        });

        await expect(createController({
            unlinkEntryRelation: vi.fn().mockRejectedValue(
                new EntryRelationConflictError("An Entry cannot be related to itself: entry-a"),
            ),
        }).unlinkEntryRelation({
            fromEntryId: "entry-a",
            toEntryId: "entry-a",
        })).rejects.toBeInstanceOf(ConflictException);
    });
});
