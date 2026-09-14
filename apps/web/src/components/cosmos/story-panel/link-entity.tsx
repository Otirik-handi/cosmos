import type {
    EntitySummary,
    StoryDetail,
} from "@cosmos/contracts";
import { type Dispatch, type FormEventHandler, type SetStateAction } from "react";
import {
    Button,
} from "@/components/ui/button";
import {
    Input,
} from "@/components/ui/input";
import {
    ENTITY_TYPE_OPTIONS,
} from "@/components/cosmos/entity-panel";
import { EntityRow } from "./entity-row";

type Props = {
    busy: boolean;
    entityOptions?: readonly EntitySummary[];
    linkEntityId: string;
    newEntityName: string;
    newEntityType: string;
    onCreateEntityLinked?: (name: string, type: string) => Promise<void>;
    setLinkEntityId: Dispatch<SetStateAction<string>>;
    setNewEntityName: Dispatch<SetStateAction<string>>;
    setNewEntityType: Dispatch<SetStateAction<string>>;
    story: StoryDetail;
    submitCreateEntity: () => Promise<void>;
    submitLinkEntity: () => Promise<void>;
    submitUnlinkEntity: (entityId: string) => Promise<void>;
};

export function StoryLinkEntitySection({
    busy,
    entityOptions = [],
    linkEntityId,
    newEntityName,
    newEntityType,
    onCreateEntityLinked,
    setLinkEntityId,
    setNewEntityName,
    setNewEntityType,
    story,
    submitCreateEntity,
    submitLinkEntity,
    submitUnlinkEntity,
}: Props) {
    return (
        <>
            {story.entities.length > 0 && (
                <section
                    aria-label="关联实体"
                    className="grid gap-3 border-t pt-4"
                >
                    <h3 className="font-medium">
                        关联实体（{story.entities.length}）
                    </h3>
                    <ul>
                        {story.entities.map((link) => (
                            <EntityRow
                                key={link.entityId}
                                link={link}
                                busy={busy}
                                onUnlink={submitUnlinkEntity}
                            />
                        ))}
                    </ul>
                </section>
            )}
            {entityOptions && entityOptions.length > 0 && (
                <section
                    aria-label="关联 Entity"
                    className="grid gap-3 border-t pt-4"
                >
                    <h3 className="font-medium">关联已有 Entity</h3>
                    <div className="flex flex-wrap items-center gap-2">
                        <select
                            aria-label="选择 Entity"
                            value={linkEntityId}
                            disabled={busy}
                            className="rounded-sm border bg-card px-2 py-1 text-sm"
                            onChange={(event) => setLinkEntityId(event.target.value)}
                        >
                            <option value="">选择 Entity…</option>
                            {entityOptions.map((item) => (
                                <option
                                    key={item.id}
                                    value={item.id}
                                    disabled={story.entities.some((link) => {
                                        return link.entityId === item.id;
                                    })}
                                >
                                    {item.name}
                                </option>
                            ))}
                        </select>
                        <Button
                            variant="outline"
                            disabled={busy || !linkEntityId}
                            onClick={() => void submitLinkEntity()}
                        >
                            关联
                        </Button>
                    </div>
                </section>
            )}
            {onCreateEntityLinked && (
                <section
                    aria-label="创建 Entity"
                    className="grid gap-3 border-t pt-4"
                >
                    <h3 className="font-medium">创建 Entity 并关联本 Story</h3>
                    <Input
                        id="cosmos-new-entity-name"
                        value={newEntityName}
                        onChange={(event) => setNewEntityName(event.target.value)}
                        disabled={busy}
                        placeholder="Entity 名称，例如 Jeff Dean"
                    />
                    <select
                        aria-label="Entity 类型"
                        value={newEntityType}
                        disabled={busy}
                        className="w-fit rounded-sm border bg-card px-2 py-1 text-sm"
                        onChange={(event) => setNewEntityType(event.target.value)}
                    >
                        {ENTITY_TYPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                    <Button
                        variant="outline"
                        className="w-fit"
                        disabled={busy || !newEntityName.trim()}
                        onClick={() => void submitCreateEntity()}
                    >
                        创建并关联
                    </Button>
                </section>
            )}
        </>
    );
}
