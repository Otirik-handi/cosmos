import { useState } from "react";

import type { StoryDetail } from "@cosmos/contracts";

import { StoryMarkingSection } from "@/components/cosmos/story-panel/story-marking";
import { messages } from "@/copy/messages";

/**
 * 「我的标记」段（C 段）的写入层：收藏、固定到看板、标签、收藏夹、批注。
 *
 * 本组件只做两件事：把 `StoryEditPanel` 持有的 busy/错误漏斗套在每个写入动作上，
 * 以及持有「收藏进行中」这一个跨点击的状态。表单草稿（选中的标签、编辑中/新建的批注）
 * 归 `StoryMarkingSection` 自己——它们只在那一段内部用得到。
 */
type Props = {
    story: StoryDetail;
    busy: boolean;
    setBusy: (value: boolean) => void;
    setActionError: (value: string | null) => void;
    labelOptions?: readonly import("@cosmos/contracts").LabelRef[];
    collections?: readonly Pick<
        import("@cosmos/contracts").CollectionSummary,
        "id" | "name" | "containsStory"
    >[];
    annotations?: readonly import("@cosmos/contracts").Annotation[];
    onAttachLabel?: (labelId: string) => Promise<void>;
    onDetachLabel?: (labelId: string) => Promise<void>;
    onToggleCollection?: (collectionId: string, member: boolean) => Promise<void>;
    onCreateAnnotation?: (input: { body: string; quote?: string | null }) => Promise<void>;
    onUpdateAnnotation?: (
        annotationId: string,
        input: { body: string; quote?: string | null },
    ) => Promise<void>;
    onDeleteAnnotation?: (annotationId: string) => Promise<void>;
    onPinToBoard?: () => Promise<void>;
    onToggleFavorite?: () => Promise<void>;
};

export function StoryMarkingEditor({
    story,
    busy,
    setBusy,
    setActionError,
    labelOptions,
    collections,
    annotations,
    onAttachLabel,
    onDetachLabel,
    onToggleCollection,
    onCreateAnnotation,
    onUpdateAnnotation,
    onDeleteAnnotation,
    onPinToBoard,
    onToggleFavorite,
}: Props) {
    /** 收藏请求进行中：按钮据此禁用，避免连点产生两条 toggle。 */
    const [togglingFavorite, setTogglingFavorite] = useState(false);

    /** 所有写入都走同一条漏斗：置 busy、清错误、失败落到四段共用的错误行。 */
    const runAction = async (action: () => Promise<void>): Promise<void> => {
        setBusy(true);
        setActionError(null);
        try {
            await action();
        } catch (error) {
            setActionError(error instanceof Error ? error.message : messages.reading.storyEdit.marking.actionFailed);
        } finally {
            setBusy(false);
        }
    };

    return (
        <StoryMarkingSection
            annotations={annotations}
            busy={busy}
            collections={collections}
            labelOptions={labelOptions}
            story={story}
            submitAttachLabel={(labelId) => onAttachLabel
                ? runAction(() => onAttachLabel(labelId))
                : Promise.resolve()}
            submitCreateAnnotation={(input) => onCreateAnnotation
                ? runAction(() => onCreateAnnotation(input))
                : Promise.resolve()}
            submitDeleteAnnotation={(annotationId) => onDeleteAnnotation
                ? runAction(() => onDeleteAnnotation(annotationId))
                : Promise.resolve()}
            submitDetachLabel={(labelId) => onDetachLabel
                ? runAction(() => onDetachLabel(labelId))
                : Promise.resolve()}
            submitPinToBoard={onPinToBoard ? () => runAction(onPinToBoard) : undefined}
            submitToggleCollection={(collectionId, member) => onToggleCollection
                ? runAction(() => onToggleCollection(collectionId, member))
                : Promise.resolve()}
            submitToggleFavorite={onToggleFavorite
                ? async () => {
                    setTogglingFavorite(true);
                    try {
                        await runAction(onToggleFavorite);
                    } finally {
                        setTogglingFavorite(false);
                    }
                }
                : undefined}
            submitUpdateAnnotation={(annotationId, input) => onUpdateAnnotation
                ? runAction(() => onUpdateAnnotation(annotationId, input))
                : Promise.resolve()}
            togglingFavorite={togglingFavorite}
        />
    );
}
