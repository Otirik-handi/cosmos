"use client";

import { useState } from "react";

import {
    topicMemberRoleSchema,
    type TopicDetail,
    type TopicMember,
    type TopicMemberRole,
} from "@cosmos/contracts";

import { Button } from "@/components/ui/button";
import { messages } from "@/copy/messages";

/*
 * 成员：在话题里的（改角色 / 移除）与已移除的（选好角色再恢复）分两段列出。
 * 成员**加入**只在 Story 页发生（ADR-0029 决策 1：关联动作就地），所以这里没有加入入口。
 *
 * 成员行显示 Story 标题；标题读不到时用占位句——**不退回 storyId**（判据 R3）。
 * 读侧的 `role` 是宽松字符串，存储里出现未知取值时显示「未标注角色」，也不回显内部取值。
 */

/** 角色顺序取自合同枚举：合同加一个角色，这里自动多一个选项。 */
const ROLE_ORDER: readonly TopicMemberRole[] = topicMemberRoleSchema.options;

function isTopicMemberRole(value: string): value is TopicMemberRole {
    return topicMemberRoleSchema.safeParse(value).success;
}

function roleLabel(role: TopicMemberRole): string {
    return messages.pages.topics.detail.roles[role];
}

function memberTitle(member: TopicMember): string {
    return member.title ?? messages.pages.topics.detail.memberMissingTitle;
}

/** 已知角色按合同顺序列出；未知取值额外给一个选项，好让用户能把它改成已知角色。 */
function roleOptions(role: string): readonly { value: string; label: string }[] {
    const known = ROLE_ORDER.map((value) => ({ label: roleLabel(value), value }));
    return isTopicMemberRole(role)
        ? known
        : [{ label: messages.pages.topics.detail.roleUnknown, value: role }, ...known];
}

type MemberHandlers = {
    onChangeRole: (storyId: string, role: TopicMemberRole) => Promise<void>;
    onRemove: (storyId: string) => Promise<void>;
    onRestore: (storyId: string, role: TopicMemberRole) => Promise<void>;
};

function MemberRow({ member, ...handlers }: { member: TopicMember } & MemberHandlers) {
    /** 忙状态按行持有：一行提交时只禁用这一行，其它行仍可操作。 */
    const [busy, setBusy] = useState(false);
    /** 恢复要重新指定角色，所以已移除的行有自己的角色草稿；在话题里的行直接显示服务端值。 */
    const [restoreRole, setRestoreRole] = useState<TopicMemberRole>(
        isTopicMemberRole(member.role) ? member.role : ROLE_ORDER[0],
    );
    const title = memberTitle(member);
    const value = member.removed ? restoreRole : member.role;

    const run = async (action: () => Promise<void>): Promise<void> => {
        setBusy(true);
        try {
            await action();
        } finally {
            setBusy(false);
        }
    };

    return (
        <li className="flex flex-wrap items-center gap-2 border-b border-border py-3 last:border-b-0">
            <span className="min-w-0 flex-1 truncate text-[14px]">{title}</span>
            <select
                aria-label={messages.pages.topics.detail.memberRoleLabel(title)}
                className="h-8 rounded-[var(--radius-control)] border border-input bg-card px-2 text-[13px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                disabled={busy}
                onChange={(event) => {
                    const next = event.target.value;
                    if (!isTopicMemberRole(next)) {
                        return;
                    }
                    if (member.removed) {
                        setRestoreRole(next);
                        return;
                    }
                    void run(() => handlers.onChangeRole(member.storyId, next));
                }}
                value={value}
            >
                {roleOptions(member.role).map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
            {member.removed ? (
                <Button
                    aria-label={messages.pages.topics.detail.memberRestoreLabel(title)}
                    disabled={busy}
                    onClick={() => void run(() => handlers.onRestore(member.storyId, restoreRole))}
                    size="sm"
                    variant="outline"
                >
                    {messages.pages.topics.detail.memberRestore}
                </Button>
            ) : (
                <Button
                    aria-label={messages.pages.topics.detail.memberRemoveLabel(title)}
                    disabled={busy}
                    onClick={() => void run(() => handlers.onRemove(member.storyId))}
                    size="sm"
                    variant="ghost"
                >
                    {messages.pages.topics.detail.memberRemove}
                </Button>
            )}
        </li>
    );
}

export function TopicMembersSection({
    topic,
    ...handlers
}: { topic: TopicDetail } & MemberHandlers) {
    const active = topic.members.filter((member) => !member.removed);
    const removed = topic.members.filter((member) => member.removed);

    return (
        <section
            aria-label={messages.pages.topics.detail.membersTitle}
            className="flex flex-col gap-3"
        >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-[15px] font-medium">
                    {messages.pages.topics.detail.membersTitle}
                </h2>
                <span className="text-[12px] text-muted-foreground">
                    {messages.pages.topics.detail.membersSummary}
                </span>
            </div>

            {topic.members.length === 0 ? (
                <div className="rounded-[var(--radius-card)] border border-dashed border-border px-4 py-8 text-center">
                    <p className="text-[13px] font-medium">
                        {messages.pages.topics.detail.membersEmpty}
                    </p>
                    <p className="mx-auto mt-1 max-w-md text-[12px] leading-5 text-muted-foreground">
                        {messages.pages.topics.detail.membersEmptyBody}
                    </p>
                </div>
            ) : (
                <>
                    {active.length === 0 ? (
                        <p className="text-[13px] text-muted-foreground">
                            {messages.pages.topics.detail.membersNoneActive}
                        </p>
                    ) : (
                        <ul className="flex flex-col">
                            {active.map((member) => (
                                <MemberRow key={member.storyId} member={member} {...handlers} />
                            ))}
                        </ul>
                    )}

                    {removed.length > 0 && (
                        <div className="flex flex-col gap-2 border-t border-border pt-3">
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                <h3 className="text-[13px] font-medium">
                                    {messages.pages.topics.detail.membersRemovedTitle}
                                </h3>
                                <span className="text-[12px] text-muted-foreground">
                                    {messages.pages.topics.detail.membersRemovedHint}
                                </span>
                            </div>
                            <ul className="flex flex-col">
                                {removed.map((member) => (
                                    <MemberRow key={member.storyId} member={member} {...handlers} />
                                ))}
                            </ul>
                        </div>
                    )}
                </>
            )}
        </section>
    );
}
