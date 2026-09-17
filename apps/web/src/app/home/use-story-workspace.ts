import {
    useCallback,
    useRef,
    useState,
} from "react";
import {
    type Annotation,
    type CollectionList,
    type EntryListItem,
    type EntryRelationType,
    type EntryStoryRelationType,
    type LabelList,
    type MigrateStoryUserStateCommand,
    type SplitStoryCommand,
    type StoryDetail,
    type StorySubtype,
    type UpdateStoryRevisionCommand,
} from "@cosmos/contracts";
import {
    loadRelatedStories,
    type RelatedStory,
} from "@/lib/related-stories";
import type { StoryUserStateSnapshot } from "@/components/cosmos/story-panel/user-state-migration";
import type { StoryEntryOption } from "@/components/cosmos/story-panel/entry-option";
import {
    client,
    readError,
    RELATED_STORY_PORTS,
} from "./page-runtime";
import type { WorkspaceContext } from "./page-bridge";

/** 由 G06 切片 4 从 page.tsx 拆出的域 hook（搬运，未改行为）。 */
export function useStoryWorkspace(ctx: WorkspaceContext) {
    const [story, setStory] = useState<StoryDetail | null>(null);
    const [storySubtypes, setStorySubtypes] = useState<readonly StorySubtype[]>([]);
    const [relatedStories, setRelatedStories] = useState<readonly RelatedStory[]>([]);
    const [entryOptions, setEntryOptions] = useState<
        readonly Pick<EntryListItem, "id" | "title" | "sourceName">[]
    >([]);
    const [keyFactEntryOptions, setKeyFactEntryOptions] = useState<readonly StoryEntryOption[]>([]);
    const [labels, setLabels] = useState<LabelList>({ items: [] });
    const [collections, setCollections] = useState<CollectionList>({ items: [] });
    const [storyAnnotations, setStoryAnnotations] = useState<readonly Annotation[]>([]);
    const [openingStoryId, setOpeningStoryId] = useState<string | null>(null);
    const openStoryIdRef = useRef<string | null>(null);
    const refreshRelatedStories = useCallback(async (detail: StoryDetail): Promise<void> => {
        try {
            const next = await loadRelatedStories(detail, RELATED_STORY_PORTS);
            if (openStoryIdRef.current === detail.story.id) {
                setRelatedStories(next);
            }
        } catch {
            if (openStoryIdRef.current === detail.story.id) {
                setRelatedStories([]);
            }
        }
    }, []);

    const openStory = async (storyId: string): Promise<void> => {
        setOpeningStoryId(storyId);
        ctx.setError(null);
        try {
        const [storyDetail, storyCollections, entryPage] = await Promise.all([
            client.story(storyId),
            client.listCollections({ storyId }),
            // 证据关系候选：最近条目里排除本 Story 自己的成员。
            client.entries({ limit: 50 }),
        ]);
        // 批注按 canonical Story id 归属：Feed 传入的 id 可能指向已归并的旧 Story。
        const annotationList = await client.listAnnotations({
            targetType: "story",
            targetId: storyDetail.story.id,
        });
        setStory(storyDetail);
        setCollections(storyCollections);
        setStoryAnnotations(annotationList.items);
        setEntryOptions(entryPage.items
            .filter((item) => item.storyId !== storyDetail.story.id)
            .map((item) => ({
                id: item.id,
                title: item.title,
                sourceName: item.sourceName,
            })));
        // 关键事实的出处可以是任何条目、不要求属于本 Story（ADR-0021 决定 3），
        // 所以这里保留全量已加载条目，只标记成员身份供界面分组排序。
        setKeyFactEntryOptions(entryPage.items.map((item) => ({
            id: item.id,
            title: item.title,
            sourceName: item.sourceName,
            isMember: item.storyId === storyDetail.story.id,
        })));
            // 相关内容是附加区块：先渲染 Story，再后台补齐，读取失败不阻塞阅读。
            openStoryIdRef.current = storyDetail.story.id;
            setRelatedStories([]);
            void refreshRelatedStories(storyDetail);
        } catch (caught) {
            ctx.setError(readError(caught));
        } finally {
            setOpeningStoryId(null);
        }
    };

    const closeStory = useCallback((): void => {
        openStoryIdRef.current = null;
        setStory(null);
        setRelatedStories([]);
        setEntryOptions([]);
        setKeyFactEntryOptions([]);
    }, []);

    /** 证据关系写命令返回 canonical StoryDetail，直接刷新面板即可。 */
    const linkEntryStory = async (input: {
        entryId: string;
        relationType: EntryStoryRelationType;
    }): Promise<void> => {
        if (!story) {
            return;
        }
        const updated = await client.linkEntryStory({
            entryId: input.entryId,
            storyId: story.story.id,
            relationType: input.relationType,
        });
        setStory(updated);
    };

    const unlinkEntryStory = async (entryId: string): Promise<void> => {
        if (!story) {
            return;
        }
        const updated = await client.unlinkEntryStory({
            entryId,
            storyId: story.story.id,
        });
        setStory(updated);
    };

    /**
     * 条目↔条目关系挂在条目内容身份上，不属于本 Story：写命令返回的是
     * fromEntryId 那一侧的 EntryDetail，所以要重读 Story 面板才能刷新成员行
     * （ADR-0022 决定 4）。
     */
    const linkEntryRelation = async (input: {
        fromEntryId: string;
        toEntryId: string;
        relationType: EntryRelationType;
    }): Promise<void> => {
        if (!story) {
            return;
        }
        await client.linkEntryRelation({ ...input, actor: "user" });
        setStory(await client.story(story.story.id));
    };

    const unlinkEntryRelation = async (input: {
        fromEntryId: string;
        toEntryId: string;
    }): Promise<void> => {
        if (!story) {
            return;
        }
        await client.unlinkEntryRelation({ ...input, actor: "user" });
        setStory(await client.story(story.story.id));
    };

    const updateStoryRevision = async (command: UpdateStoryRevisionCommand): Promise<void> => {
        if (!story) {
            return;
        }
        const updated = await client.updateStoryRevision(story.story.id, command);
        setStory(updated);
    };

    const mergeStory = async (obsoleteStoryId: string): Promise<void> => {
        if (!story) {
            return;
        }
        const updated = await client.mergeStories({
            canonicalStoryId: story.story.id,
            obsoleteStoryIds: [obsoleteStoryId],
        });
        setStory(updated);
    };

    const splitStory = async (command: SplitStoryCommand): Promise<void> => {
        if (!story) {
            return;
        }
        // 拆分命令返回历史壳，面板随即切换到壳视图（后继列表可继续打开）。
        const updated = await client.splitStory(story.story.id, command);
        setStory(updated);
        await refreshRelatedStories(updated);
    };

    /**
     * 读取拆分家族某个成员上的 Story 级用户状态，供迁移表单的来源侧使用。
     * 批注/收藏夹/看板固定各自有独立读端点，这里按同一个 Story 目标合并成一份清单。
     */
    const loadStoryUserState = useCallback(async (storyId: string): Promise<StoryUserStateSnapshot> => {
        const [detail, storyCollections, annotationList, placements] = await Promise.all([
            client.story(storyId),
            client.listCollections({ storyId }),
            client.listAnnotations({ targetType: "story", targetId: storyId }),
            client.listSpotlightPlacements(),
        ]);
        return {
            favorite: detail.favorited,
            labels: detail.labels.map((label) => ({ id: label.id, name: label.name })),
            collections: storyCollections.items
                .filter((collection) => collection.containsStory === true)
                .map((collection) => ({ id: collection.id, name: collection.name })),
            annotations: annotationList.items.map((annotation) => ({
                id: annotation.id,
                name: annotation.body,
            })),
            placements: placements.items
                .filter((placement) => placement.targetType === "story"
                    && placement.targetId === storyId)
                .map((placement) => ({ id: placement.id, name: placement.boardId })),
        };
    }, []);

    /**
     * 在同一个拆分家族内迁移 Story 级用户状态（ADR-0020）；反向调用即撤销。
     * 迁完后重读当前面板：历史壳上的标记清单可能刚刚变少。
     */
    const migrateStoryUserState = async (input: {
        sourceStoryId: string;
        command: MigrateStoryUserStateCommand;
    }): Promise<void> => {
        const result = await client.migrateStoryUserState(input.sourceStoryId, {
            ...input.command,
            actor: "user",
        });
        const counts = [
            result.favorite,
            result.labelAssignments,
            result.collectionItems,
            result.annotations,
            result.spotlightPlacements,
        ];
        const moved = counts.reduce((sum, count) => sum + count.moved, 0);
        const deduped = counts.reduce((sum, count) => sum + count.deduped, 0);
        ctx.setNotice(deduped > 0
            ? `已迁移 ${moved} 项标记；${deduped} 项因去向已有相同标记而跳过。`
            : `已迁移 ${moved} 项标记。`);
        if (story) {
            setStory(await client.story(story.story.id));
            await refreshStoryCollections();
            await refreshStoryAnnotations();
        }
    };

    /** 标签/收藏变更后重读打开的 Story，并把标签列表刷到最新指派计数。 */
    const refreshStoryWithLabels = async (): Promise<void> => {
        if (!story) {
            return;
        }
        const [nextStory, nextLabels] = await Promise.all([
            client.story(story.story.id),
            client.listLabels(),
        ]);
        setStory(nextStory);
        setLabels(nextLabels);
        await refreshRelatedStories(nextStory);
    };

    /** 刷新当前 Story 的收藏夹成员视图（携带 containsStory 与 itemCount）。 */
    const refreshStoryCollections = async (): Promise<void> => {
        if (!story) {
            return;
        }
        setCollections(await client.listCollections({ storyId: story.story.id }));
    };

    const toggleStoryFavorite = async (favorited: boolean): Promise<void> => {
        if (!story) {
            return;
        }
        if (favorited) {
            await client.setFavorite({ targetType: "story", targetId: story.story.id });
            ctx.setNotice("已收藏当前 Story。");
        } else {
            await client.unsetFavorite({ targetType: "story", targetId: story.story.id });
            ctx.setNotice("已取消收藏当前 Story。");
        }
        setStory(await client.story(story.story.id));
    };

    const attachLabelToStory = async (labelId: string): Promise<void> => {
        if (!story) {
            return;
        }
        await client.attachLabel({
            labelId,
            targetType: "story",
            targetId: story.story.id,
        });
        await refreshStoryWithLabels();
    };

    const detachLabelFromStory = async (labelId: string): Promise<void> => {
        if (!story) {
            return;
        }
        await client.detachLabel({
            labelId,
            targetType: "story",
            targetId: story.story.id,
        });
        await refreshStoryWithLabels();
    };

    /**
     * 面板“新建标签”控件只传名称、拿不到新标签 id，所以创建后直接打上当前
     * Story：一次交互完成“建标签 + 添加”两件事。
     */
    const createLabelForStory = async (name: string): Promise<void> => {
        if (!story) {
            return;
        }
        const created = await client.createLabel({ name });
        await client.attachLabel({
            labelId: created.id,
            targetType: "story",
            targetId: story.story.id,
        });
        ctx.setNotice(`已创建标签「${name}」并添加到当前 Story。`);
        await refreshStoryWithLabels();
    };

    const toggleStoryCollection = async (
        collectionId: string,
        member: boolean,
    ): Promise<void> => {
        if (!story) {
            return;
        }
        if (member) {
            await client.removeCollectionItem(collectionId, { storyId: story.story.id });
            ctx.setNotice("已把当前 Story 移出该收藏夹。");
        } else {
            await client.addCollectionItem(collectionId, { storyId: story.story.id });
            ctx.setNotice("已把当前 Story 加入该收藏夹。");
        }
        await refreshStoryCollections();
    };

    const createCollectionFromPanel = async (name: string): Promise<void> => {
        if (!story) {
            return;
        }
        const created = await client.createCollection({ name });
        ctx.setNotice(`已创建收藏夹「${created.name}」。`);
        await refreshStoryCollections();
    };

    const refreshStoryAnnotations = async (): Promise<void> => {
        if (!story) {
            return;
        }
        const list = await client.listAnnotations({
            targetType: "story",
            targetId: story.story.id,
        });
        setStoryAnnotations(list.items);
    };

    const createStoryAnnotation = async (input: {
        body: string;
        quote?: string | null;
    }): Promise<void> => {
        if (!story) {
            return;
        }
        await client.createAnnotation({
            targetType: "story",
            targetId: story.story.id,
            body: input.body,
            quote: input.quote ?? null,
        });
        ctx.setNotice("已添加批注。");
        await refreshStoryAnnotations();
    };

    const updateStoryAnnotation = async (
        annotationId: string,
        input: { body: string; quote?: string | null },
    ): Promise<void> => {
        if (!story) {
            return;
        }
        await client.updateAnnotation(annotationId, {
            body: input.body,
            quote: input.quote ?? null,
        });
        ctx.setNotice("已更新批注。");
        await refreshStoryAnnotations();
    };

    const deleteStoryAnnotation = async (annotationId: string): Promise<void> => {
        if (!story) {
            return;
        }
        await client.deleteAnnotation(annotationId);
        ctx.setNotice("已删除批注。");
        await refreshStoryAnnotations();
    };


    return {
        attachLabelToStory,
        closeStory,
        collections,
        createCollectionFromPanel,
        createLabelForStory,
        createStoryAnnotation,
        deleteStoryAnnotation,
        detachLabelFromStory,
        entryOptions,
        keyFactEntryOptions,
        labels,
        linkEntryRelation,
        linkEntryStory,
        loadStoryUserState,
        mergeStory,
        migrateStoryUserState,
        openStory,
        openingStoryId,
        refreshRelatedStories,
        relatedStories,
        setCollections,
        setLabels,
        setStory,
        setStorySubtypes,
        splitStory,
        story,
        storyAnnotations,
        storySubtypes,
        toggleStoryCollection,
        toggleStoryFavorite,
        unlinkEntryRelation,
        unlinkEntryStory,
        updateStoryAnnotation,
        updateStoryRevision,
    };
}
