

export function SplitTargetSelect({
    label,
    value,
    successors,
    disabled,
    onChange,
}: {
    label: string;
    value: number;
    successors: readonly { title: string }[];
    disabled: boolean;
    onChange: (next: number) => void;
}) {
    return (
        <label className="flex flex-col gap-1 text-sm">
            <span className="truncate text-muted-foreground">{label}</span>
            <select
                aria-label={`${label} 的拆分去向`}
                value={value}
                disabled={disabled}
                className="rounded-sm border bg-card px-2 py-1 text-sm"
                onChange={(event) => onChange(Number(event.target.value))}
            >
                <option value={-1}>留在历史壳</option>
                {successors.map((successor, index) => (
                    <option key={index} value={index}>
                        {successor.title.trim() || `后继 ${index + 1}`}
                    </option>
                ))}
            </select>
        </label>
    );
}
