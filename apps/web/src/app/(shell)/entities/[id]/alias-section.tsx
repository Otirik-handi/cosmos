"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { messages } from "@/copy/messages";

import { DetailMessage, DetailSection } from "./detail-section";

type AliasSectionProps = {
    aliases: readonly string[];
    busy: boolean;
    /** 返回是否成功：失败时保留输入，用户不必重打一遍。 */
    onAdd: (name: string) => Promise<boolean>;
    onRemove: (name: string) => Promise<boolean>;
};

/** 名称别名：加一个别的叫法、删掉不再用的叫法。 */
export function AliasSection({ aliases, busy, onAdd, onRemove }: AliasSectionProps) {
    const [name, setName] = useState("");

    const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault();
        const value = name.trim();
        if (value === "" || busy) {
            return;
        }
        if (await onAdd(value)) {
            setName("");
        }
    };

    return (
        <DetailSection
            count={aliases.length === 0 ? null : messages.pages.entities.detail.aliasCount(aliases.length)}
            title={messages.pages.entities.detail.aliasTitle}
        >
            <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => void submit(event)}>
                <label className="text-[13px] text-muted-foreground" htmlFor="entity-alias-name">
                    {messages.pages.entities.detail.aliasNew}
                </label>
                <Input
                    className="max-w-xs"
                    disabled={busy}
                    id="entity-alias-name"
                    onChange={(event) => setName(event.target.value)}
                    value={name}
                />
                <Button
                    disabled={busy || name.trim() === ""}
                    size="sm"
                    type="submit"
                    variant="outline"
                >
                    <Plus data-icon="inline-start" />
                    {messages.pages.entities.detail.aliasAdd}
                </Button>
            </form>

            {aliases.length === 0 ? (
                <DetailMessage>{messages.pages.entities.detail.aliasEmpty}</DetailMessage>
            ) : (
                <ul className="flex flex-wrap gap-2">
                    {aliases.map((alias) => (
                        <li
                            className="flex items-center gap-1 rounded-[var(--radius-pill)] border border-border py-0.5 pr-0.5 pl-2"
                            key={alias}
                        >
                            <span className="text-[13px]">{alias}</span>
                            <Button
                                aria-label={messages.pages.entities.detail.aliasRemove(alias)}
                                disabled={busy}
                                onClick={() => void onRemove(alias)}
                                size="icon-xs"
                                variant="ghost"
                            >
                                <Trash2 aria-hidden className="size-3" strokeWidth={1.75} />
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
        </DetailSection>
    );
}
