"use client";

import { useEffect, useState } from "react";

import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { messages } from "@/copy/messages";

/**
 * 归并目标选择器：按标题搜索要并入的那条 Story。
 *
 * 取代粘贴内部 Story ID 的输入框（判据 R3：界面不要求用户输入或背诵内部标识符）。
 *
 * 候选来自既有的 `GET /search`（Task 36 切片 B 的结论：不新增读查询）。两条边界写在这里，
 * 不藏进调用方：
 * ① 搜索以 **Entry** 为投影单位，同一条 Story 会有多行——按 storyId 去重后才是候选；
 * ② 因此候选只包含**有当前 Revision 的 Story**，历史壳与零成员 Story 无法作为归并目标。
 */
export type MergeTargetCandidate = {
    storyId: string;
    title: string;
};

type Props = {
    /** 按标题搜索候选；空串表示「给我最近的内容」。 */
    onSearch: (text: string) => Promise<readonly MergeTargetCandidate[]>;
    /** 当前 Story：从候选里排除，避免「并入自己」。 */
    currentStoryId: string;
    disabled?: boolean;
    /** 选中一条候选。 */
    onSelect: (candidate: MergeTargetCandidate) => void;
};

/** 输入停顿多久才发一次搜索。持续输入时只打一次接口，而不是每个字符一次。 */
const SEARCH_DEBOUNCE_MS = 400;

export function MergeTargetSelect({
    onSearch,
    currentStoryId,
    disabled = false,
    onSelect,
}: Props) {
    /*
     * 输入框的值由 Base UI 自己持有，这里只记「当前的搜索词」。
     *
     * 曾经把 `value={text}` 直接压在 `ComboboxInput` 上，结果是**选中候选后输入框仍显示搜索词**
     * （维护者 D5 验收发现：搜「派评」选中后框里还是「派评」，不是完整标题）。原因是受控的
     * `value` 覆盖了组件选中后回填 `itemToStringLabel` 的行为。
     * 现在只订阅 `onInputValueChange`，并且**只在用户真的改字时才更新搜索词**：选中候选同样会
     * 触发这个回调（reason 为 `item-press`），那时输入框里已经是完整标题，若跟着当成搜索词
     * 就会立刻用标题再搜一次、把候选列表换掉。
     */
    const [searchText, setSearchText] = useState("");
    const [candidates, setCandidates] = useState<readonly MergeTargetCandidate[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const timer = setTimeout(() => {
            setLoading(true);
            void onSearch(searchText)
                .then((found) => {
                    if (!cancelled) {
                        setCandidates(found);
                    }
                })
                .catch(() => {
                    // 搜索失败只让候选为空：这里没有承载错误的位置，归并按钮的提交
                    // 仍会给出服务端拒绝的原因，比在候选框里塞一条错误更少歧义。
                    if (!cancelled) {
                        setCandidates([]);
                    }
                })
                .finally(() => {
                    if (!cancelled) {
                        setLoading(false);
                    }
                });
        }, SEARCH_DEBOUNCE_MS);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [onSearch, searchText]);

    const selectable = candidates.filter((candidate) => candidate.storyId !== currentStoryId);

    return (
        <Combobox
            disabled={disabled}
            /*
             * `filter={null}`：候选已经由服务端搜索筛过一遍，客户端再按输入串筛一次是**二次过滤**——
             * 输入串是搜索词、选项标题是完整标题，两者不等长时会把服务端返回的候选全部滤掉
             * （实测：搜出 2 条候选，一敲字就变 0 条）。Base UI 的 `filter={null}` 正是为
             * 「过滤交给外部」准备的。
             */
            filter={null}
            items={selectable}
            itemToStringLabel={(candidate: MergeTargetCandidate) => candidate.title}
            onInputValueChange={(value, eventDetails) => {
                if (eventDetails.reason === "input-change" || eventDetails.reason === "input-clear") {
                    setSearchText(value);
                }
            }}
            onValueChange={(candidate: MergeTargetCandidate | null) => {
                if (candidate !== null) {
                    onSelect(candidate);
                }
            }}
        >
            <ComboboxInput
                aria-label={messages.reading.storyEdit.mergeTargetLabel}
                placeholder={messages.reading.storyEdit.mergeTargetPlaceholder}
            />
            <ComboboxContent>
                <ComboboxEmpty>
                    {loading
                        ? messages.reading.storyEdit.mergeTargetSearching
                        : messages.reading.storyEdit.mergeTargetEmpty}
                </ComboboxEmpty>
                <ComboboxList<MergeTargetCandidate>>
                    {(candidate) => (
                        <ComboboxItem key={candidate.storyId} value={candidate}>
                            {candidate.title}
                        </ComboboxItem>
                    )}
                </ComboboxList>
            </ComboboxContent>
        </Combobox>
    );
}
