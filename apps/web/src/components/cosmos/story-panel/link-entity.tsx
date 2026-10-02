import type {
    EntitySummary,
    StoryDetail,
} from "@cosmos/contracts";
import { type Dispatch, type SetStateAction } from "react";
import {
    Button,
} from "@/components/ui/button";
import { EntityRow } from "./entity-row";

type Props = {
    busy: boolean;
    entityOptions?: readonly EntitySummary[];
    linkEntityId: string;
    setLinkEntityId: Dispatch<SetStateAction<string>>;
    story: StoryDetail;
    submitLinkEntity: () => Promise<void>;
    submitUnlinkEntity: (entityId: string) => Promise<void>;
};

export function StoryLinkEntitySection({
    busy,
    entityOptions = [],
    linkEntityId,
    setLinkEntityId,
    story,
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
        </>
    );
}
