import type {CSSProperties} from "react";

import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Separator} from "@/components/ui/separator";

import type {
    LabColorwayId,
    LabComponentDefinition,
    LabProps,
    LabScene,
    LabThemeId,
    LabViewportId,
} from "./types";

type LabStageProps = {
    colorway: LabColorwayId;
    definition: LabComponentDefinition;
    props: LabProps;
    scene: LabScene;
    theme: LabThemeId;
    tokenOverrides: Readonly<Record<string, string>>;
    viewport: LabViewportId;
    onColorwayChange: (value: LabColorwayId) => void;
    onSceneChange: (value: string) => void;
    onViewportChange: (value: LabViewportId) => void;
};

export function LabStage({
    colorway,
    definition,
    props,
    scene,
    theme,
    tokenOverrides,
    viewport,
    onColorwayChange,
    onSceneChange,
    onViewportChange,
}: LabStageProps) {
    const previewStyle = Object.fromEntries(Object.entries(tokenOverrides)) as CSSProperties;
    return (
        <Card className="min-w-0 overflow-hidden">
            <CardHeader className="gap-4 border-b bg-[color:var(--surface-toolbar,var(--card))]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <CardTitle>{definition.label}</CardTitle>
                            <Badge variant="outline">{scene.label}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            {scene.description ?? "用固定 fixture 观察组件合同和边界状态。"}
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            aria-pressed={colorway === "macos-light"}
                            onClick={() => onColorwayChange("macos-light")}
                            size="sm"
                            variant={colorway === "macos-light" ? "secondary" : "ghost"}
                        >
                            macOS Light
                        </Button>
                        <Button
                            aria-pressed={colorway === "macos-night"}
                            onClick={() => onColorwayChange("macos-night")}
                            size="sm"
                            variant={colorway === "macos-night" ? "secondary" : "ghost"}
                        >
                            macOS Night
                        </Button>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-sm" htmlFor="lab-scene">
                        场景
                        <select
                            className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                            id="lab-scene"
                            onChange={(event) => onSceneChange(event.currentTarget.value)}
                            value={scene.id}
                        >
                            {definition.scenes.map((item) => (
                                <option key={item.id} value={item.id}>
                                    {item.label}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="flex items-center gap-2 text-sm" htmlFor="lab-viewport">
                        画布
                        <select
                            className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                            id="lab-viewport"
                            onChange={(event) => onViewportChange(event.currentTarget.value as LabViewportId)}
                            value={viewport}
                        >
                            <option value="responsive">Responsive</option>
                            <option value="wide">Wide</option>
                        </select>
                    </label>
                </div>
            </CardHeader>
            <CardContent className="min-h-[32rem] bg-muted/30 p-4 md:p-8">
                <div className="flex min-h-[28rem] items-center justify-center overflow-auto rounded-xl border border-dashed border-border bg-background/70 p-4 md:p-8">
                    <div className={viewport === "wide" ? "flex w-full max-w-5xl justify-center" : "flex w-full max-w-2xl justify-center"}>
                        <div
                            className={colorway === "macos-night" ? "dark flex w-full justify-center rounded-[var(--radius-control,10px)] bg-background p-6 text-foreground" : "flex w-full justify-center rounded-[var(--radius-control,10px)] bg-background p-6 text-foreground"}
                            data-component-lab-preview
                            data-cosmos-colorway={colorway}
                            data-cosmos-theme={theme}
                            style={previewStyle}
                        >
                            {definition.render(props)}
                        </div>
                    </div>
                </div>
                <Separator className="my-5" />
                <p className="text-xs text-muted-foreground">
                    真实组件渲染 · 无 API / SSE / 用户数据 · 当前主题 neurobook
                </p>
            </CardContent>
        </Card>
    );
}
