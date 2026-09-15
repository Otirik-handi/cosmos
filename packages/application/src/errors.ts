/** 域错误类型:NotFound / RevisionConflict / Merge|Split|Relation|Alias|NameConflict / Invalid。 */

import type {
    Annotation,
} from "@cosmos/contracts";

export class SourceNotFoundError extends Error {
    readonly code = "not_found" as const;

    constructor(sourceId: string) {
        super(`Source not found: ${sourceId}`);
        this.name = "SourceNotFoundError";
    }
}

export class SourceRevisionConflictError extends Error {
    readonly code = "conflict" as const;

    constructor(sourceId: string) {
        super(`Source revision conflict: ${sourceId}`);
        this.name = "SourceRevisionConflictError";
    }
}

export class ConnectionNotFoundError extends Error {
    readonly code = "not_found" as const;

    constructor(connectionId: string) {
        super(`Connection not found: ${connectionId}`);
        this.name = "ConnectionNotFoundError";
    }
}

export class StoryNotFoundError extends Error {
    readonly code = "not_found" as const;

    constructor(storyId: string) {
        super(`Story not found: ${storyId}`);
        this.name = "StoryNotFoundError";
    }
}

export class StoryRevisionConflictError extends Error {
    readonly code = "conflict" as const;

    constructor(storyId: string) {
        super(`Story revision conflict: ${storyId}`);
        this.name = "StoryRevisionConflictError";
    }
}

export class StoryMergeConflictError extends Error {
    readonly code = "conflict" as const;

    constructor(message: string) {
        super(message);
        this.name = "StoryMergeConflictError";
    }
}

export class StorySplitConflictError extends Error {
    readonly code = "conflict" as const;

    constructor(message: string) {
        super(message);
        this.name = "StorySplitConflictError";
    }
}

/**
 * A Story subtype is not a writable registration of the target core kind
 * (ORG-013). Distinct from `conflict`: the request itself is invalid, not the
 * Story state.
 */
export class StorySubtypeInvalidError extends Error {
    readonly code = "validation" as const;

    constructor(message: string) {
        super(message);
        this.name = "StorySubtypeInvalidError";
    }
}

/**
 * A user-state migration names source/target Stories that are not in the same
 * split family, or names a row that is not currently on the source Story
 * (ADR-0020 decision 3).
 */
export class StoryUserStateMigrationConflictError extends Error {
    readonly code = "conflict" as const;

    constructor(message: string) {
        super(message);
        this.name = "StoryUserStateMigrationConflictError";
    }
}

export class TopicNotFoundError extends Error {
    readonly code = "not_found" as const;

    constructor(topicId: string) {
        super(`Topic not found: ${topicId}`);
        this.name = "TopicNotFoundError";
    }
}

export class TopicRevisionConflictError extends Error {
    readonly code = "conflict" as const;

    constructor(topicId: string) {
        super(`Topic revision conflict: ${topicId}`);
        this.name = "TopicRevisionConflictError";
    }
}

export class TopicMergeConflictError extends Error {
    readonly code = "conflict" as const;

    constructor(message: string) {
        super(message);
        this.name = "TopicMergeConflictError";
    }
}

export class TopicMembershipNotFoundError extends Error {
    readonly code = "not_found" as const;

    constructor(message: string) {
        super(message);
        this.name = "TopicMembershipNotFoundError";
    }
}

export class EntityNotFoundError extends Error {
    readonly code = "not_found" as const;

    constructor(entityId: string) {
        super(`Entity not found: ${entityId}`);
        this.name = "EntityNotFoundError";
    }
}

export class EntityRevisionConflictError extends Error {
    readonly code = "conflict" as const;

    constructor(entityId: string) {
        super(`Entity revision conflict: ${entityId}`);
        this.name = "EntityRevisionConflictError";
    }
}

export class EntityRelationConflictError extends Error {
    readonly code = "conflict" as const;

    constructor(message: string) {
        super(message);
        this.name = "EntityRelationConflictError";
    }
}

export class EntityAliasConflictError extends Error {
    readonly code = "conflict" as const;

    constructor(message: string) {
        super(message);
        this.name = "EntityAliasConflictError";
    }
}

export class LabelNotFoundError extends Error {
    readonly code = "not_found" as const;

    constructor(labelId: string) {
        super(`Label not found: ${labelId}`);
        this.name = "LabelNotFoundError";
    }
}

export class LabelConflictError extends Error {
    readonly code = "conflict" as const;

    constructor(message: string) {
        super(message);
        this.name = "LabelConflictError";
    }
}

export class CollectionNotFoundError extends Error {
    readonly code = "not_found" as const;

    constructor(collectionId: string) {
        super(`Collection not found: ${collectionId}`);
        this.name = "CollectionNotFoundError";
    }
}

export class EntryNotFoundError extends Error {
    readonly code = "not_found" as const;

    constructor(entryId: string) {
        super(`Entry not found: ${entryId}`);
        this.name = "EntryNotFoundError";
    }
}

/**
 * An Entry cannot be linked to its own primary Story: `Entry.storyId` already
 * expresses that membership, and allowing both would blur "member" and
 * "evidence" (ADR-0011 decision 3).
 */
export class EntryStoryLinkConflictError extends Error {
    readonly code = "conflict" as const;

    constructor(entryId: string, storyId: string) {
        super(`Entry ${entryId} already belongs to Story ${storyId}`);
        this.name = "EntryStoryLinkConflictError";
    }
}

export class AnnotationNotFoundError extends Error {
    readonly code = "not_found" as const;

    constructor(annotationId: string) {
        super(`Annotation not found: ${annotationId}`);
        this.name = "AnnotationNotFoundError";
    }
}

export class SavedViewNotFoundError extends Error {
    readonly code = "not_found" as const;

    constructor(savedViewId: string) {
        super(`Saved view not found: ${savedViewId}`);
        this.name = "SavedViewNotFoundError";
    }
}

export class BoardNotFoundError extends Error {
    readonly code = "not_found" as const;

    constructor(boardId: string) {
        super(`Board not found: ${boardId}`);
        this.name = "BoardNotFoundError";
    }
}

export class BoardNameConflictError extends Error {
    readonly code = "conflict" as const;

    constructor(name: string) {
        super(`Board name already in use: ${name}`);
        this.name = "BoardNameConflictError";
    }
}

export class BoardSectionNotFoundError extends Error {
    readonly code = "not_found" as const;

    constructor(sectionId: string) {
        super(`Board section not found: ${sectionId}`);
        this.name = "BoardSectionNotFoundError";
    }
}

export class BoardBlockNotFoundError extends Error {
    readonly code = "not_found" as const;

    constructor(blockId: string) {
        super(`Board block not found: ${blockId}`);
        this.name = "BoardBlockNotFoundError";
    }
}

export class SpotlightPlacementNotFoundError extends Error {
    readonly code = "not_found" as const;

    constructor(placementId: string) {
        super(`Spotlight placement not found: ${placementId}`);
        this.name = "SpotlightPlacementNotFoundError";
    }
}

export class RunFinalizationError extends Error {
    constructor(cause: unknown) {
        super("Run finalization failed.", { cause });
        this.name = "RunFinalizationError";
    }
}
