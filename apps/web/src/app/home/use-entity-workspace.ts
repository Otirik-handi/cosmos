import {
    useCallback,
    useState,
} from "react";
import {
    type EntityDetail,
    type EntityRelationType,
    type EntitySummary,
    type EntityType,
    type UpdateEntityCommand,
} from "@cosmos/contracts";
import {
    client,
    readError,
} from "./page-runtime";
import type { WorkspaceContext } from "./page-bridge";
import type { useStoryWorkspace } from "./use-story-workspace";

type StoryApi = ReturnType<typeof useStoryWorkspace>;

/** 由 G06 切片 4 从 page.tsx 拆出的域 hook（搬运，未改行为）。 */
export function useEntityWorkspace(ctx: WorkspaceContext, storyApi: StoryApi) {
    const [entities, setEntities] = useState<readonly EntitySummary[]>([]);
    const [entity, setEntity] = useState<EntityDetail | null>(null);
    const [openingEntityId, setOpeningEntityId] = useState<string | null>(null);
    const loadEntities = useCallback(async (): Promise<void> => {
        try {
            const page = await client.listEntities({ limit: 50 });
            setEntities(page.items);
        } catch {
            // 实体列表读取失败不阻断主 Feed；显式打开时才暴露错误。
        }
    }, []);

    const openEntity = async (entityId: string): Promise<void> => {
        setOpeningEntityId(entityId);
        ctx.setError(null);
        try {
            setEntity(await client.entity(entityId));
        } catch (caught) {
            ctx.setError(readError(caught));
        } finally {
            setOpeningEntityId(null);
        }
    };

    const updateEntityPage = async (command: UpdateEntityCommand): Promise<void> => {
        if (!entity) {
            return;
        }
        const updated = await client.updateEntity(entity.entity.id, command);
        setEntity(updated);
        await loadEntities();
    };

    const addEntityAliasPage = async (name: string): Promise<void> => {
        if (!entity) {
            return;
        }
        const updated = await client.addEntityAlias(entity.entity.id, { name });
        setEntity(updated);
        await loadEntities();
    };

    const removeEntityAliasPage = async (name: string): Promise<void> => {
        if (!entity) {
            return;
        }
        const updated = await client.removeEntityAlias(entity.entity.id, { name });
        setEntity(updated);
        await loadEntities();
    };

    const refreshStoryAfterEntityChange = async (): Promise<void> => {
        if (!storyApi.story) {
            return;
        }
        const nextStory = await client.story(storyApi.story.story.id);
        storyApi.setStory(nextStory);
        await loadEntities();
        await storyApi.refreshRelatedStories(nextStory);
    };

    const unlinkStoryFromEntityPage = async (storyId: string): Promise<void> => {
        if (!entity) {
            return;
        }
        const updated = await client.unlinkStoryEntity({
            storyId,
            entityId: entity.entity.id,
        });
        setEntity(updated);
        await loadEntities();
        if (storyApi.story?.story.id === storyId) {
            storyApi.setStory(await client.story(storyId));
        }
    };

    const createRelationFromEntityPage = async (
        toEntityId: string,
        relationType: EntityRelationType,
    ): Promise<void> => {
        if (!entity) {
            return;
        }
        const updated = await client.createEntityRelation({
            fromEntityId: entity.entity.id,
            toEntityId,
            relationType,
        });
        setEntity(updated);
        await loadEntities();
    };

    const removeRelationFromEntityPage = async (relation: {
        fromEntityId: string;
        toEntityId: string;
        relationType: string;
    }): Promise<void> => {
        if (!entity) {
            return;
        }
        const updated = await client.removeEntityRelation(relation);
        setEntity(updated);
        await loadEntities();
    };

    const linkEntityToStory = async (entityId: string): Promise<void> => {
        if (!storyApi.story) {
            return;
        }
        await client.linkStoryEntity({
            storyId: storyApi.story.story.id,
            entityId,
        });
        await refreshStoryAfterEntityChange();
    };

    const createEntityLinkedToStory = async (
        name: string,
        type: string,
    ): Promise<void> => {
        if (!storyApi.story) {
            return;
        }
        const created = await client.createEntity({
            name,
            type: type as EntityType,
        });
        await client.linkStoryEntity({
            storyId: storyApi.story.story.id,
            entityId: created.entity.id,
        });
        ctx.setNotice(`已创建 Entity「${name}」并关联当前 Story。`);
        await refreshStoryAfterEntityChange();
    };

    const unlinkEntityFromStory = async (entityId: string): Promise<void> => {
        if (!storyApi.story) {
            return;
        }
        await client.unlinkStoryEntity({
            storyId: storyApi.story.story.id,
            entityId,
        });
        await refreshStoryAfterEntityChange();
    };


    return {
        addEntityAliasPage,
        createEntityLinkedToStory,
        createRelationFromEntityPage,
        entities,
        entity,
        linkEntityToStory,
        loadEntities,
        openEntity,
        openingEntityId,
        removeEntityAliasPage,
        removeRelationFromEntityPage,
        setEntity,
        unlinkEntityFromStory,
        unlinkStoryFromEntityPage,
        updateEntityPage,
    };
}
