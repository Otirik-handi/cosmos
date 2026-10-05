import type {LabTokenDefinition, LabTokenName} from "./types";

/*
 * 可调节 token 登记表。默认值取 V4 亮色方案的取值，评审者在实验室里改的是
 * 预览画布的覆盖值，不写回源码。分册见 docs/proposals/frontend-redesign/layer-1-v4-design-system.md。
 */
export const labTokenDefinitions = [
    {
        name: "--background",
        label: "画布底",
        kind: "color",
        defaultValue: "#f4f3ee",
    },
    {
        name: "--card",
        label: "卡片面",
        kind: "color",
        defaultValue: "#fffefb",
    },
    {
        name: "--paper",
        label: "阅读面",
        kind: "color",
        defaultValue: "#fcfbf6",
    },
    {
        name: "--foreground",
        label: "正文",
        kind: "color",
        defaultValue: "#1c1f1c",
    },
    {
        name: "--muted-foreground",
        label: "次要文字",
        kind: "color",
        defaultValue: "#666a62",
    },
    {
        name: "--primary",
        label: "强调色",
        kind: "color",
        defaultValue: "#2c5f4f",
    },
    {
        name: "--primary-foreground",
        label: "强调色上的文字",
        kind: "color",
        defaultValue: "#ffffff",
    },
    {
        name: "--marker",
        label: "机器来源",
        kind: "color",
        defaultValue: "#8d5a20",
        description: "只用于系统与 Agent 产生的内容，不当作通用强调色。",
    },
    {
        name: "--marker-soft",
        label: "机器来源底色",
        kind: "color",
        defaultValue: "#f5ecdc",
    },
    {
        name: "--muted",
        label: "次级面",
        kind: "color",
        defaultValue: "#eae8e1",
    },
    {
        name: "--border",
        label: "分隔线",
        kind: "color",
        defaultValue: "#e6e4dc",
    },
    {
        name: "--destructive",
        label: "错误",
        kind: "color",
        defaultValue: "#9d3529",
    },
    {
        name: "--radius-control",
        label: "控件圆角",
        kind: "length",
        defaultValue: "6px",
    },
    {
        name: "--radius-card",
        label: "卡片圆角",
        kind: "length",
        defaultValue: "14px",
    },
    {
        name: "--divider-thickness",
        label: "分隔线粗细",
        kind: "length",
        defaultValue: "0.75em",
        description: "横向分隔线的粗细；竖向线固定 1px（同值会把竖线变成色块）。",
    },
] as const satisfies readonly LabTokenDefinition[];

export const labTokenNames = labTokenDefinitions.map(
    (token): LabTokenName => token.name,
);
