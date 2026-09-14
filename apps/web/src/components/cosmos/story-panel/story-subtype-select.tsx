import {
    StoryDetail,
    StorySubtype,
} from "@cosmos/contracts";

/** 目录里属于该 kind 的注册项才可用于新写入（ORG-013）。 */
export function registeredStorySubtype(
    options: readonly StorySubtype[],
    subtype: string | null,
    kind: StoryDetail["story"]["kind"],
): string | null {
    if (subtype === null) {
        return null;
    }
    return options.some((option) => option.id === subtype && option.kind === kind)
        ? subtype
        : null;
}

export function StorySubtypeSelect({
    id,
    label,
    value,
    kind,
    options,
    disabled,
    onChange,
}: {
    id: string;
    label: string;
    value: string | null;
    kind: StoryDetail["story"]["kind"];
    options: readonly StorySubtype[];
    disabled: boolean;
    onChange: (value: string | null) => void;
}) {
    const forKind = options.filter((option) => option.kind === kind);
    // 旧数据可能是未注册值；原样保留而不是替用户丢掉。
    const showLegacy = value !== null && !forKind.some((option) => option.id === value);
    return (
        <select
            id={id}
            aria-label={label}
            value={value ?? ""}
            disabled={disabled}
            className="rounded-sm border bg-card px-2 py-1 text-sm"
            onChange={(event) => {
                onChange(event.target.value === "" ? null : event.target.value);
            }}
        >
            <option value="">无 subtype</option>
            {showLegacy && <option value={value}>{value}（未注册）</option>}
            {forKind.map((option) => (
                <option key={option.id} value={option.id}>
                    {option.label}（{option.id}）{option.status === "deprecated" ? " · 已弃用" : ""}
                </option>
            ))}
        </select>
    );
}
