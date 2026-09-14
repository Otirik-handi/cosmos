import type {
    TopicSummary,
} from "@cosmos/contracts";
import { type Dispatch, type FormEventHandler, type SetStateAction } from "react";
import {
    TopicMemberRole,
} from "@cosmos/contracts";
import {
    Button,
} from "@/components/ui/button";
import {
    Input,
} from "@/components/ui/input";
import {
    ROLE_OPTIONS,
} from "@/components/cosmos/topic-panel";

type Props = {
    busy: boolean;
    joinRole: TopicMemberRole;
    joinTopicId: string;
    newTopicPurpose: string;
    newTopicTitle: string;
    onCreateTopic?: (title: string, purpose: string) => Promise<void>;
    setJoinRole: Dispatch<SetStateAction<TopicMemberRole>>;
    setJoinTopicId: Dispatch<SetStateAction<string>>;
    setNewTopicPurpose: Dispatch<SetStateAction<string>>;
    setNewTopicTitle: Dispatch<SetStateAction<string>>;
    submitCreateTopic: () => Promise<void>;
    submitJoinTopic: () => Promise<void>;
    topics?: readonly TopicSummary[];
};

export function StoryTopicSection({
    busy,
    joinRole,
    joinTopicId,
    newTopicPurpose,
    newTopicTitle,
    onCreateTopic,
    setJoinRole,
    setJoinTopicId,
    setNewTopicPurpose,
    setNewTopicTitle,
    submitCreateTopic,
    submitJoinTopic,
    topics = [],
}: Props) {
    return (
        <>
            {topics && topics.length > 0 && (
                <section
                    aria-label="加入 Topic"
                    className="grid gap-3 border-t pt-4"
                >
                    <h3 className="font-medium">加入 Topic</h3>
                    <div className="flex flex-wrap items-center gap-2">
                        <select
                            aria-label="选择 Topic"
                            value={joinTopicId}
                            disabled={busy}
                            className="rounded-sm border bg-card px-2 py-1 text-sm"
                            onChange={(event) => setJoinTopicId(event.target.value)}
                        >
                            <option value="">选择 Topic…</option>
                            {topics.map((item) => (
                                <option key={item.id} value={item.id}>
                                    {item.title}
                                </option>
                            ))}
                        </select>
                        <select
                            aria-label="加入角色"
                            value={joinRole}
                            disabled={busy}
                            className="rounded-sm border bg-card px-2 py-1 text-sm"
                            onChange={(event) => {
                                setJoinRole(event.target.value as TopicMemberRole);
                            }}
                        >
                            {ROLE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                        <Button
                            variant="outline"
                            disabled={busy || !joinTopicId}
                            onClick={() => void submitJoinTopic()}
                        >
                            加入
                        </Button>
                    </div>
                </section>
            )}
            {onCreateTopic && (
                <section
                    aria-label="创建 Topic"
                    className="grid gap-3 border-t pt-4"
                >
                    <h3 className="font-medium">创建 Topic 并加入本 Story</h3>
                    <Input
                        id="cosmos-new-topic-title"
                        value={newTopicTitle}
                        onChange={(event) => setNewTopicTitle(event.target.value)}
                        disabled={busy}
                        placeholder="Topic 标题"
                    />
                    <Input
                        id="cosmos-new-topic-purpose"
                        value={newTopicPurpose}
                        onChange={(event) => setNewTopicPurpose(event.target.value)}
                        disabled={busy}
                        placeholder="关注目的"
                    />
                    <Button
                        variant="outline"
                        className="w-fit"
                        disabled={busy || !newTopicTitle.trim() || !newTopicPurpose.trim()}
                        onClick={() => void submitCreateTopic()}
                    >
                        创建并加入
                    </Button>
                </section>
            )}
        </>
    );
}
