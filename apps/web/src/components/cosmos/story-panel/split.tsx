import type {
    SplitStoryCommand,
    StorySubtype,
    TopicSummary,
} from "@cosmos/contracts";
import { type Dispatch, type FormEventHandler, type SetStateAction } from "react";
import {
    StoryDetail,
} from "@cosmos/contracts";
import {
    Button,
} from "@/components/ui/button";
import {
    Input,
} from "@/components/ui/input";
import {
    StorySubtypeSelect,
} from "./story-subtype-select";
import { SplitTargetSelect } from "./split-target-select";

type Props = {
    addSplitSuccessor: () => void;
    busy: boolean;
    isShell: boolean;
    onSplitStory?: (command: SplitStoryCommand) => Promise<void>;
    setSplitEntityTargets: Dispatch<SetStateAction<Record<string, number>>>;
    setSplitEntryTargets: Dispatch<SetStateAction<Record<string, number>>>;
    setSplitEvidenceTargets: Dispatch<SetStateAction<Record<string, number>>>;
    setSplitTopicTargets: Dispatch<SetStateAction<Record<string, number>>>;
    splitEntityTargets: Record<string, number>;
    splitEntryTargets: Record<string, number>;
    splitEvidenceTargets: Record<string, number>;
    splitSuccessors: Array<{ title: string; kind: StoryDetail["story"]["kind"]; subtype: string | null }>;
    splitTopicTargets: Record<string, number>;
    story: StoryDetail;
    submitSplit: FormEventHandler;
    subtypeOptions?: readonly StorySubtype[];
    topics?: readonly TopicSummary[];
    updateSplitSuccessor: (index: number, patch: Partial<{ title: string; kind: StoryDetail["story"]["kind"]; subtype: string | null }>) => void;
};

export function StorySplitSection({
    addSplitSuccessor,
    busy,
    isShell,
    onSplitStory,
    setSplitEntityTargets,
    setSplitEntryTargets,
    setSplitEvidenceTargets,
    setSplitTopicTargets,
    splitEntityTargets,
    splitEntryTargets,
    splitEvidenceTargets,
    splitSuccessors,
    splitTopicTargets,
    story,
    submitSplit,
    subtypeOptions = [],
    topics = [],
    updateSplitSuccessor,
}: Props) {
    return (
        <>
            {!isShell && onSplitStory && story.entries.length >= 2 && (
                <form
                    aria-label="拆分 Story"
                    className="grid gap-3 border-t pt-4"
                    onSubmit={submitSplit}
                >
                    <h3 className="font-medium">拆分 Story</h3>
                    <p className="text-sm text-muted-foreground">
                        把本条 Story 拆成多个后继；没有指定去向的成员、证据、实体与 Topic 会留在本条历史壳上。
                    </p>
                    <div className="grid gap-2">
                        {splitSuccessors.map((successor, index) => (
                            <div
                                key={index}
                                className="flex flex-wrap items-center gap-2"
                            >
                                <label
                                    htmlFor={`cosmos-split-title-${index}`}
                                    className="text-sm font-medium"
                                >
                                    后继 {index + 1}
                                </label>
                                <Input
                                    id={`cosmos-split-title-${index}`}
                                    value={successor.title}
                                    onChange={(event) => {
                                        updateSplitSuccessor(index, { title: event.target.value });
                                    }}
                                    disabled={busy}
                                    className="max-w-xs"
                                />
                                <select
                                    aria-label={`后继 ${index + 1} 类型`}
                                    value={successor.kind}
                                    disabled={busy}
                                    className="rounded-sm border bg-card px-2 py-1 text-sm"
                                    onChange={(event) => {
                                        updateSplitSuccessor(index, {
                                            kind: event.target.value as StoryDetail["story"]["kind"],
                                        });
                                    }}
                                >
                                    <option value="event">event</option>
                                    <option value="document">document</option>
                                    <option value="media">media</option>
                                    <option value="thread">thread</option>
                                </select>
                                <StorySubtypeSelect
                                    id={`cosmos-split-subtype-${index}`}
                                    label={`后继 ${index + 1} subtype`}
                                    value={successor.subtype}
                                    kind={successor.kind}
                                    options={subtypeOptions}
                                    disabled={busy}
                                    onChange={(value) => {
                                        updateSplitSuccessor(index, { subtype: value });
                                    }}
                                />
                            </div>
                        ))}
                        {splitSuccessors.length < 5 && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="w-fit"
                                disabled={busy}
                                onClick={addSplitSuccessor}
                            >
                                增加后继
                            </Button>
                        )}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                        {story.entries.map((member) => (
                            <SplitTargetSelect
                                key={member.id}
                                label={`成员 ${member.sourceName} · ${member.revisions[0]?.title ?? member.id}`}
                                value={splitEntryTargets[member.id] ?? -1}
                                successors={splitSuccessors}
                                disabled={busy}
                                onChange={(next) => {
                                    setSplitEntryTargets((current) => ({ ...current, [member.id]: next }));
                                }}
                            />
                        ))}
                        {story.evidence.map((item) => (
                            <SplitTargetSelect
                                key={item.entryId}
                                label={`证据 ${item.title ?? item.entryId}`}
                                value={splitEvidenceTargets[item.entryId] ?? -1}
                                successors={splitSuccessors}
                                disabled={busy}
                                onChange={(next) => {
                                    setSplitEvidenceTargets((current) => ({ ...current, [item.entryId]: next }));
                                }}
                            />
                        ))}
                        {story.entities.map((item) => (
                            <SplitTargetSelect
                                key={item.entityId}
                                label={`实体 ${item.name}`}
                                value={splitEntityTargets[item.entityId] ?? -1}
                                successors={splitSuccessors}
                                disabled={busy}
                                onChange={(next) => {
                                    setSplitEntityTargets((current) => ({ ...current, [item.entityId]: next }));
                                }}
                            />
                        ))}
                        {story.topics.map((item) => (
                            <SplitTargetSelect
                                key={item.topicId}
                                label={`Topic ${item.title}`}
                                value={splitTopicTargets[item.topicId] ?? -1}
                                successors={splitSuccessors}
                                disabled={busy}
                                onChange={(next) => {
                                    setSplitTopicTargets((current) => ({ ...current, [item.topicId]: next }));
                                }}
                            />
                        ))}
                    </div>
                    <Button
                        type="submit"
                        disabled={busy}
                        variant="outline"
                        className="w-fit"
                        data-testid="story-split-submit"
                    >
                        拆分
                    </Button>
                </form>
            )}
        </>
    );
}
