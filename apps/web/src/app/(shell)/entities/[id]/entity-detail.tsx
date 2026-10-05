"use client";

import { RefreshCcw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { EntityRelationType } from "@cosmos/contracts";
import { CosmosTransportError } from "@cosmos/transport-http";

import { client, readError } from "@/app/home/page-runtime";
import { useEntityWorkspace } from "@/app/home/use-entity-workspace";
import { useNoticeToast } from "@/app/home/use-notice-toast";
import { useStoryWorkspace } from "@/app/home/use-story-workspace";

import { entityTypeLabel } from "@/components/cosmos/entity-panel";
import { useLiveTopic } from "@/components/shell/live-provider";
import { PageBanners } from "@/components/shell/page-banners";
import { Button } from "@/components/ui/button";
import { messages } from "@/copy/messages";

import { AliasSection } from "./alias-section";
import { RelationSection } from "./relation-section";
import { StoryLinkSection } from "./story-link-section";

/*
 * Entity 详情（`/entities/:id`）：别名增删、与另一个 Entity 的类型化关系增删、
 * 解除关联 Story。三件事都走 `useEntityWorkspace` 里已有的页面方法（命令与读回都在这层），
 * 页面只负责把结果画出来。
 *
 * 界面**不出现内部标识符**（判据 R3）：路由 id 不进任何一处文案，关系与关联 Story
 * 也只显示名称——关系合同只给 id，所以名称要么来自工作区列表，要么逐个读详情补。
 *
 * 已知缺口：改名与改类型（`POST /entities/:id/revisions`）不在这一页，切片范围只要求上面三件事。
 */
export function EntityDetailView({ entityId }: { entityId: string }) {
    const [loading, setLoading] = useState(true);
    const [missing, setMissing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);
    /** 工作区列表（默认前 50 个）没覆盖到的关系对端名称。 */
    const [extraNames, setExtraNames] = useState<ReadonlyMap<string, string>>(() => new Map());

    /** 写回执走 toast；`error` 仍由页面横幅显示。上下文对象身份稳定由 hook 保证。 */
    const { context: workspaceContext, showNotice } = useNoticeToast(setError, setLoading);
    const storyWorkspace = useStoryWorkspace(workspaceContext);
    const {
        addEntityAliasPage,
        createRelationFromEntityPage,
        entities,
        entity,
        loadEntities,
        removeEntityAliasPage,
        removeRelationFromEntityPage,
        setEntity,
        unlinkStoryFromEntityPage,
    } = useEntityWorkspace(workspaceContext, storyWorkspace);

    /**
     * 首屏与刷新共用一次读取。状态写入都在 await 之后，effect 首帧不产生级联渲染；
     * `setLoading(true)` 只由刷新按钮同步调用。
     */
    const load = useCallback(async (): Promise<void> => {
        try {
            const detail = await client.entity(entityId);
            setEntity(detail);
            setMissing(false);
            setError(null);
        } catch (caught) {
            if (caught instanceof CosmosTransportError && caught.status === 404) {
                setEntity(null);
                setMissing(true);
                setError(null);
            } else {
                setError(readError(caught));
            }
        } finally {
            setLoading(false);
        }
    }, [entityId, setEntity]);

    useEffect(() => {
        // load 的第一次写状态在 await 之后，首帧不会同步级联渲染；规则不跨 async 边界判断。
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load();
        void loadEntities();
    }, [load, loadEntities]);

    // Entity 的关联 Story 会随 Story 侧的动作变化，实时事件到了就重读一次。
    useLiveTopic("stories", () => {
        void load();
        void loadEntities();
    });

    const names = useMemo(() => {
        const map = new Map<string, string>();
        for (const item of entities) {
            map.set(item.id, item.name);
        }
        if (entity !== null) {
            map.set(entity.entity.id, entity.entity.name);
        }
        for (const [id, name] of extraNames) {
            map.set(id, name);
        }
        return map;
    }, [entities, entity, extraNames]);

    /*
     * 关系两端在界面上必须显示名称（判据 R3），而关系合同只给 id：先用工作区列表补，
     * 补不到的再逐个读详情。读不到的对端退回占位文案，绝不放 id 本身。
     */
    useEffect(() => {
        if (entity === null) {
            return;
        }
        const missingIds = [
            ...new Set(entity.relations.flatMap((relation) => [
                relation.fromEntityId,
                relation.toEntityId,
            ])),
        ].filter((id) => !names.has(id));
        if (missingIds.length === 0) {
            return;
        }
        let cancelled = false;
        void (async () => {
            const found: (readonly [string, string])[] = [];
            await Promise.all(missingIds.map(async (id) => {
                try {
                    found.push([id, (await client.entity(id)).entity.name] as const);
                } catch {
                    // 单个对端读不到不影响其它行。
                }
            }));
            if (cancelled || found.length === 0) {
                return;
            }
            setExtraNames((previous) => new Map([...previous, ...found]));
        })();
        return () => {
            cancelled = true;
        };
    }, [entity, names]);

    const nameOf = useCallback(
        (id: string): string => names.get(id) ?? messages.pages.entities.detail.counterpartUnknown,
        [names],
    );

    const relationCandidates = useMemo(
        () => entities
            .filter((item) => item.id !== entityId)
            .map((item) => ({ id: item.id, name: item.name })),
        [entities, entityId],
    );

    /** 写动作的统一收尾：回执进 toast、失败进错误横幅，返回是否成功给表单决定要不要清空输入。 */
    const runAction = async (action: () => Promise<void>, receipt: string): Promise<boolean> => {
        setPending(true);
        setError(null);
        try {
            await action();
            showNotice(receipt);
            return true;
        } catch (caught) {
            setError(readError(caught));
            return false;
        } finally {
            setPending(false);
        }
    };

    const addAlias = (name: string): Promise<boolean> =>
        runAction(() => addEntityAliasPage(name), messages.notices.entity.aliasAdded(name));

    const removeAlias = (name: string): Promise<boolean> =>
        runAction(() => removeEntityAliasPage(name), messages.notices.entity.aliasRemoved(name));

    const createRelation = (
        toEntityId: string,
        relationType: EntityRelationType,
    ): Promise<boolean> =>
        runAction(
            () => createRelationFromEntityPage(toEntityId, relationType),
            messages.notices.entity.relationAdded(nameOf(toEntityId)),
        );

    const removeRelation = (relation: {
        fromEntityId: string;
        toEntityId: string;
        relationType: string;
    }): Promise<boolean> => {
        const counterpartId = relation.fromEntityId === entityId
            ? relation.toEntityId
            : relation.fromEntityId;
        return runAction(
            () => removeRelationFromEntityPage(relation),
            messages.notices.entity.relationRemoved(nameOf(counterpartId)),
        );
    };

    const unlinkStory = (storyId: string, title: string): Promise<boolean> =>
        runAction(
            () => unlinkStoryFromEntityPage(storyId),
            messages.notices.entity.storyUnlinked(title),
        );

    const refresh = (): void => {
        setLoading(true);
        void load();
    };

    return (
        <div className="flex w-full flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
                <Link
                    className="text-[13px] text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    href="/entities"
                >
                    {messages.pages.entities.backToList}
                </Link>
                <h1 className="text-[15px] font-medium">
                    {entity === null ? messages.pages.entities.detailTitle : entity.entity.name}
                </h1>
                {entity !== null && (
                    <span className="text-[12px] text-muted-foreground">
                        {entityTypeLabel(entity.entity.type)}
                    </span>
                )}
                <Button
                    className="ml-auto"
                    disabled={loading || pending}
                    onClick={refresh}
                    size="sm"
                    variant="outline"
                >
                    <RefreshCcw data-icon="inline-start" />
                    {messages.common.refresh}
                </Button>
            </div>

            <PageBanners error={error} />

            {loading ? (
                <p className="text-[13px] text-muted-foreground">{messages.common.loading}</p>
            ) : entity === null ? (
                missing ? (
                    <div className="rounded-[var(--radius-card)] border border-dashed border-border px-4 py-10 text-center">
                        <p className="text-[13px] font-medium">
                            {messages.pages.entities.detail.notFoundTitle}
                        </p>
                        <p className="mx-auto mt-1 max-w-md text-[12px] leading-5 text-muted-foreground">
                            {messages.pages.entities.detail.notFoundBody}
                        </p>
                        <Link
                            className="mt-4 inline-flex h-8 items-center rounded-[var(--radius-control)] border border-border px-3 text-[13px] hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                            href="/entities"
                        >
                            {messages.pages.entities.backToList}
                        </Link>
                    </div>
                ) : (
                    // 读取失败：原因在上面的错误横幅里，这里只留一个重试入口。
                    <Button onClick={refresh} size="sm" variant="outline">
                        <RefreshCcw data-icon="inline-start" />
                        {messages.common.refresh}
                    </Button>
                )
            ) : (
                <>
                    <AliasSection
                        aliases={entity.aliases}
                        busy={pending}
                        onAdd={addAlias}
                        onRemove={removeAlias}
                    />
                    <RelationSection
                        busy={pending}
                        candidates={relationCandidates}
                        nameOf={nameOf}
                        onCreate={createRelation}
                        onRemove={removeRelation}
                        relations={entity.relations}
                        selfId={entityId}
                    />
                    <StoryLinkSection
                        busy={pending}
                        links={entity.stories}
                        onUnlink={unlinkStory}
                    />
                </>
            )}
        </div>
    );
}
