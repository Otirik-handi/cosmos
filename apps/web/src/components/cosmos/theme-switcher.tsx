import {Monitor, Moon, Sun} from "lucide-react";

import {Button} from "@/components/ui/button";
import type {CosmosThemePreference} from "@/theme/theme";

const THEME_OPTIONS: readonly {
    value: CosmosThemePreference;
    label: string;
    icon: typeof Monitor;
}[] = [
    {value: "system", label: "跟随系统", icon: Monitor},
    {value: "light", label: "亮色", icon: Sun},
    {value: "dark", label: "暗色", icon: Moon},
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
