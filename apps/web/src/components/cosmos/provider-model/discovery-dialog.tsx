"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import type { CandidateOption } from "@/components/cosmos/provider-model-draft";
import { messages } from "@/copy/messages";

type ProviderModelDiscoveryDialogProps = {
    candidates: readonly CandidateOption[];
    onClose: () => void;
    onSave: (selected: readonly CandidateOption[]) => void;
};

/**
 * 发现结果的选择框：勾哪些模型，就把哪些追加到下方的录入表单，不在这里直接写入。
 *
 * 已配置的候选仍然显示但不可勾选——藏掉它们会让人以为上游已经没有这个模型。
 * 勾选状态由本组件自己持有，父组件每次打开都重新挂载，因此不需要额外的「重置」逻辑。
 */
export function ProviderModelDiscoveryDialog({ candidates, onClose, onSave }: ProviderModelDiscoveryDialogProps) {
    const [selected, setSelected] = useState<readonly string[]>([]);

    function toggle(modelId: string, checked: boolean) {
        setSelected((current) => checked
            ? [...current, modelId]
            : current.filter((value) => value !== modelId));
    }

    function save() {
        const chosen = candidates.filter((candidate) => selected.includes(candidate.modelId));
        onSave(chosen);
    }

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{messages.models.discovery.dialogTitle}</DialogTitle>
                    <DialogDescription>{messages.models.discovery.dialogHint}</DialogDescription>
                </DialogHeader>

                <ul
                    className="flex max-h-[50vh] flex-col divide-y divide-border/60 overflow-y-auto rounded-[var(--radius-control)] border border-border/60"
                    data-testid="discovery-candidates"
                >
                    {candidates.map((candidate) => {
                        const checked = selected.includes(candidate.modelId);
                        return (
                            <li key={candidate.modelId}>
                                <label className="flex min-w-0 items-center gap-2 px-3 py-2">
                                    <input
                                        checked={checked}
                                        className="size-4 rounded-sm border"
                                        disabled={candidate.configured}
                                        onChange={(event) => toggle(candidate.modelId, event.target.checked)}
                                        type="checkbox"
                                    />
                                    <span className="min-w-0 flex-1 truncate text-[13px]">{candidate.name}</span>
                                    <code className="min-w-0 max-w-[45%] truncate rounded-sm bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                        {candidate.modelId}
                                    </code>
                                    {candidate.configured && (
                                        <Badge variant="outline">{messages.models.discovery.configured}</Badge>
                                    )}
                                </label>
                            </li>
                        );
                    })}
                </ul>

                <DialogFooter>
                    <span className="mr-auto self-center text-[12px] text-muted-foreground">
                        {messages.models.discovery.dialogSelected(selected.length)}
                    </span>
                    <Button onClick={onClose} size="xs" variant="ghost">
                        {messages.models.discovery.dialogCancel}
                    </Button>
                    <Button disabled={selected.length === 0} onClick={save} size="xs">
                        {messages.models.discovery.dialogSave}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
