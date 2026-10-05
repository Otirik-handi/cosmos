"use client";

import { useState } from "react";

import type { TopicDetail } from "@cosmos/contracts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { messages } from "@/copy/messages";

/*
 * 标题与目的：同一个命令的两个字段，所以合成一个小表单、一个保存按钮。
 *
 * 草稿（`draft`）为 null 时输入框显示服务端当前值；一旦开始输入就只认草稿，
 * 页面上的重读（刷新按钮、版本冲突后的重读）不会覆盖正在编辑的内容。
 * 保存成功后草稿清空，基线换成命令回执里的新版本，再次编辑以它为准。
 */
export function TopicFieldsSection({
    topic,
    onSave,
}: {
    topic: TopicDetail;
    onSave: (draft: { title: string; purpose: string }) => Promise<boolean>;
}) {
    const [draft, setDraft] = useState<{ title: string; purpose: string } | null>(null);
    const [saving, setSaving] = useState(false);

    const title = draft?.title ?? topic.topic.title;
    const purpose = draft?.purpose ?? topic.topic.purpose;
    const changed = title.trim() !== topic.topic.title || purpose.trim() !== topic.topic.purpose;
    const canSave = !saving && changed && title.trim() !== "" && purpose.trim() !== "";

    const submit = async (): Promise<void> => {
        if (!canSave) {
            return;
        }
        setSaving(true);
        try {
            if (await onSave({ title: title.trim(), purpose: purpose.trim() })) {
                setDraft(null);
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <section
            aria-label={messages.pages.topics.detail.fieldsTitle}
            className="flex flex-col gap-3"
        >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-[15px] font-medium">
                    {messages.pages.topics.detail.fieldsTitle}
                </h2>
                <span className="text-[12px] text-muted-foreground">
                    {messages.pages.topics.detail.fieldsSummary}
                </span>
            </div>

            <form
                className="flex flex-col gap-2"
                onSubmit={(event) => {
                    event.preventDefault();
                    void submit();
                }}
            >
                <Label htmlFor="topic-detail-title">
                    {messages.pages.topics.detail.titleLabel}
                </Label>
                <Input
                    disabled={saving}
                    id="topic-detail-title"
                    onChange={(event) => setDraft({ purpose, title: event.target.value })}
                    value={title}
                />
                <Label htmlFor="topic-detail-purpose">
                    {messages.pages.topics.detail.purposeLabel}
                </Label>
                <Textarea
                    className="min-h-20"
                    disabled={saving}
                    id="topic-detail-purpose"
                    onChange={(event) => setDraft({ purpose: event.target.value, title })}
                    value={purpose}
                />
                <Button
                    className="w-fit"
                    disabled={!canSave}
                    size="sm"
                    type="submit"
                    variant="outline"
                >
                    {messages.pages.topics.detail.save}
                </Button>
            </form>
        </section>
    );
}
