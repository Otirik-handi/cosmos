import type {LabTokenDefinition, LabTokenName} from "./types";

export const labTokenDefinitions = [
    {
        name: "--background",
        label: "背景",
        kind: "color",
        defaultValue: "#f6f8fa",
    },
    {
        name: "--foreground",
        label: "前景文字",
        kind: "color",
        defaultValue: "#111827",
    },
    {
        name: "--primary",
        label: "主色",
        kind: "color",
        defaultValue: "#007aff",
    },
    {
        name: "--primary-foreground",
        label: "主色文字",
        kind: "color",
        defaultValue: "#ffffff",
    },
    {
        name: "--muted",
        label: "弱化背景",
        kind: "color",
        defaultValue: "#f0f2f5",
    },
    {
        name: "--muted-foreground",
        label: "弱化文字",
        kind: "color",
        defaultValue: "#4b5563",
    },
    {
        name: "--border",
        label: "边框",
        kind: "color",
        defaultValue: "#e5e7eb",
    },
    {
        name: "--radius",
        label: "圆角",
        kind: "length",
        defaultValue: "10px",
    },
] as const satisfies readonly LabTokenDefinition[];

export const labTokenNames = labTokenDefinitions.map(
    (token): LabTokenName => token.name,
);
