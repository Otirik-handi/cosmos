import { useState } from "react";

import type {
    Annotation,
    CollectionSummary,
    EntitySummary,
    LabelRef,
    StoryDetail,
    TopicMemberRole,
    TopicSummary,
} from "@cosmos/contracts";

import { StoryOrganizationSection } from "@/components/cosmos/story-panel/organization";
import { StoryLinkEntitySection } from "@/components/cosmos/story-panel/link-entity";
import { StoryTopicSection } from "@/components/cosmos/story-panel/topic-join";

/**
 * Story 的「整理与归属」半边：打标签、放进收藏夹、写批注、固定到看板，以及加入话题、关联 Entity。
 * 提交状态（busy 与错误行）由 StoryEditSurface 持有，两个半边共用一行错误提示。
 */
type StoryOrganizationEditorProps = {
    story: StoryDetail;
    busy: boolean;
    setBusy: (value: boolean) => void;
    setActionError: (value: string | null) => void;
    labelOptions?: readonly LabelRef[];
    collections?: readonly Pick<CollectionSummary, "id" | "name" | "containsStory">[];
    annotations?: readonly Annotation[];
    entityOptions?: readonly EntitySummary[];
    topics?: readonly TopicSummary[];
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
    onJoinTopic?: (topicId: string, role: TopicMemberRole) => Promise<void>;
    onLinkEntity?: (entityId: string) => Promise<void>;
    onUnlinkEntity?: (entityId: string) => Promise<void>;
};

export function StoryOrganizationEditor({
    story,
    busy,
    setBusy,
    setActionError,
    labelOptions,
    collections,
    annotations,
    entityOptions,
    topics,
    onAttachLabel,
    onDetachLabel,
    onToggleCollection,
    onCreateAnnotation,
    onUpdateAnnotation,
    onDeleteAnnotation,
    onPinToBoard,
    onJoinTopic,
    onLinkEntity,
    onUnlinkEntity,
}: StoryOrganizationEditorProps) {
    const [joinTopicId, setJoinTopicId] = useState("");
    const [joinRole, setJoinRole] = useState<TopicMemberRole>("core");
    const [linkEntityId, setLinkEntityId] = useState("");
    const [attachLabelId, setAttachLabelId] = useState("");
    const [newAnnotationBody, setNewAnnotationBody] = useState("");
    const [newAnnotationQuote, setNewAnnotationQuote] = useState("");
    const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);
    const [editingAnnotationBody, setEditingAnnotationBody] = useState("");
    const [editingAnnotationQuote, setEditingAnnotationQuote] = useState("");
    const submitJoinTopic = async (): Promise<void> => {
        if (!onJoinTopic || !joinTopicId) {
            return;
        }
        setBusy(true);
        setActionError(null);
        try {
            await onJoinTopic(joinTopicId, joinRole);
            setJoinTopicId("");
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "加入 Topic 失败。");
        } finally {
            setBusy(false);
        }
    };

    const submitLinkEntity = async (): Promise<void> => {
        if (!onLinkEntity || !linkEntityId) {
            return;
        }
        setBusy(true);
        setActionError(null);
        try {
            await onLinkEntity(linkEntityId);
            setLinkEntityId("");
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "关联 Entity 失败。");
        } finally {
            setBusy(false);
        }
    };

    const submitUnlinkEntity = async (entityId: string): Promise<void> => {
        if (!onUnlinkEntity) {
            return;
        }
        setBusy(true);
        setActionError(null);
        try {
            await onUnlinkEntity(entityId);
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "解除 Entity 关联失败。");
        } finally {
            setBusy(false);
        }
    };

    const submitPinToBoard = async (): Promise<void> => {
        if (!onPinToBoard) {
            return;
        }
        setBusy(true);
        setActionError(null);
        try {
            await onPinToBoard();
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "固定到看板失败。");
        } finally {
            setBusy(false);
        }
    };

    const submitAttachLabel = async (): Promise<void> => {
        if (!onAttachLabel || !attachLabelId) {
            return;
        }
        setBusy(true);
        setActionError(null);
        try {
            await onAttachLabel(attachLabelId);
            setAttachLabelId("");
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "添加标签失败。");
        } finally {
            setBusy(false);
        }
    };

    const submitDetachLabel = async (labelId: string): Promise<void> => {
        if (!onDetachLabel) {
            return;
        }
        setBusy(true);
        setActionError(null);
        try {
            await onDetachLabel(labelId);
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "移除标签失败。");
        } finally {
            setBusy(false);
        }
    };

    const submitToggleCollection = async (
        collectionId: string,
        member: boolean,
    ): Promise<void> => {
        if (!onToggleCollection) {
            return;
        }
        setBusy(true);
        setActionError(null);
        try {
            await onToggleCollection(collectionId, member);
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "更新收藏夹失败。");
        } finally {
            setBusy(false);
        }
    };

    const submitCreateAnnotation = async (): Promise<void> => {
        if (!onCreateAnnotation) {
            return;
        }
        const normalizedBody = newAnnotationBody.trim();
        if (!normalizedBody) {
            return;
        }
        const normalizedQuote = newAnnotationQuote.trim();
        setBusy(true);
        setActionError(null);
        try {
            await onCreateAnnotation({
                body: normalizedBody,
                quote: normalizedQuote || null,
            });
            setNewAnnotationBody("");
            setNewAnnotationQuote("");
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "添加批注失败。");
        } finally {
            setBusy(false);
        }
    };

    const startEditAnnotation = (annotation: Annotation): void => {
        setEditingAnnotationId(annotation.id);
        setEditingAnnotationBody(annotation.body);
        setEditingAnnotationQuote(annotation.quote ?? "");
    };

    const cancelEditAnnotation = (): void => {
        setEditingAnnotationId(null);
        setEditingAnnotationBody("");
        setEditingAnnotationQuote("");
    };

    const submitUpdateAnnotation = async (annotationId: string): Promise<void> => {
        if (!onUpdateAnnotation) {
            return;
        }
        const normalizedBody = editingAnnotationBody.trim();
        if (!normalizedBody) {
            return;
        }
        const normalizedQuote = editingAnnotationQuote.trim();
        setBusy(true);
        setActionError(null);
        try {
            await onUpdateAnnotation(annotationId, {
                body: normalizedBody,
                quote: normalizedQuote || null,
            });
            cancelEditAnnotation();
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "更新批注失败。");
        } finally {
            setBusy(false);
        }
    };

    const submitDeleteAnnotation = async (annotationId: string): Promise<void> => {
        if (!onDeleteAnnotation) {
            return;
        }
        setBusy(true);
        setActionError(null);
        try {
            await onDeleteAnnotation(annotationId);
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "删除批注失败。");
        } finally {
            setBusy(false);
        }
    };

    /** 下拉只列尚未打到本条 Story 的标签，避免重复添加。 */
    const attachableLabels = (labelOptions ?? []).filter((option) => {
        return !story.labels.some((label) => label.id === option.id);
    });

    return (
        <div className="flex flex-col gap-6">
                    <StoryOrganizationSection annotations={annotations} attachLabelId={attachLabelId} attachableLabels={attachableLabels} busy={busy} cancelEditAnnotation={cancelEditAnnotation} collections={collections} editingAnnotationBody={editingAnnotationBody} editingAnnotationId={editingAnnotationId} editingAnnotationQuote={editingAnnotationQuote} newAnnotationBody={newAnnotationBody} newAnnotationQuote={newAnnotationQuote} onAttachLabel={onAttachLabel} onCreateAnnotation={onCreateAnnotation} onDeleteAnnotation={onDeleteAnnotation} onDetachLabel={onDetachLabel} onPinToBoard={onPinToBoard} onToggleCollection={onToggleCollection} onUpdateAnnotation={onUpdateAnnotation} setAttachLabelId={setAttachLabelId} setEditingAnnotationBody={setEditingAnnotationBody} setEditingAnnotationQuote={setEditingAnnotationQuote} setNewAnnotationBody={setNewAnnotationBody} setNewAnnotationQuote={setNewAnnotationQuote} startEditAnnotation={startEditAnnotation} story={story} submitAttachLabel={submitAttachLabel} submitCreateAnnotation={submitCreateAnnotation} submitDeleteAnnotation={submitDeleteAnnotation} submitDetachLabel={submitDetachLabel} submitPinToBoard={submitPinToBoard} submitToggleCollection={submitToggleCollection} submitUpdateAnnotation={submitUpdateAnnotation} />
                    <StoryLinkEntitySection busy={busy} entityOptions={entityOptions} linkEntityId={linkEntityId} setLinkEntityId={setLinkEntityId} story={story} submitLinkEntity={submitLinkEntity} submitUnlinkEntity={submitUnlinkEntity} />
                    <StoryTopicSection busy={busy} joinRole={joinRole} joinTopicId={joinTopicId} setJoinRole={setJoinRole} setJoinTopicId={setJoinTopicId} submitJoinTopic={submitJoinTopic} topics={topics} />
        </div>
    );
}
