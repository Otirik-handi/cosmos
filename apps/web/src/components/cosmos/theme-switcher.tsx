import {Monitor, Moon, Sun} from "lucide-react";

import {Button} from "@/components/ui/button";
import type {CosmosThemePreference} from "@/theme/theme";

const THEME_OPTIONS: readonly {
    value: CosmosThemePreference;
    label: string;
    icon: typeof Monitor;
}[] = [
    {value: "system", label: "跟随系统", icon: Monitor},
    {value: "macos-light", label: "macOS Light", icon: Sun},
    {value: "macos-night", label: "macOS Night", icon: Moon},
];

type ThemeSwitcherProps = {
    value: CosmosThemePreference;
    onValueChange: (value: CosmosThemePreference) => void;
};

export function ThemeSwitcher({value, onValueChange}: ThemeSwitcherProps) {
    return (
        <div aria-label="外观主题" className="flex items-center gap-1" role="group">
            {THEME_OPTIONS.map(({icon: Icon, label, value: option}) => (
                <Button
                    aria-pressed={value === option}
                    key={option}
                    onClick={() => onValueChange(option)}
                    size="icon-sm"
                    title={label}
                    variant={value === option ? "secondary" : "ghost"}
                >
                    <span className="sr-only">{label}</span>
                    <Icon aria-hidden />
                </Button>
            ))}
        </div>
    );
}
