import {useEffect, useRef} from "react";
import type {ReactNode} from "react";

import {Toast as ToastPrimitive} from "@base-ui/react/toast";
import type {FeedItem} from "@cosmos/contracts";

import {AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger} from "@/components/ui/alert-dialog";
import {Button} from "@/components/ui/button";
import {Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList} from "@/components/ui/combobox";
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger} from "@/components/ui/dialog";
import {Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger} from "@/components/ui/menu";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs";
import {ToastHost, ToastProvider} from "@/components/ui/toast";
import {SystemOutputBlock} from "@/components/cosmos/system-output-block";
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@/components/ui/tooltip";

import type {LabControlDefinition, LabProps} from "./types";

/*
 * 切片 2 新增 primitive 的实验室 fixture。
 *
 * 弹层类部件用非受控 `defaultOpen` 而不是受控 `open`：受控打开时组件没有走完真实的
 * 初始化路径，Esc 关闭、焦点陷阱、菜单键盘高亮都不成立，实验室就失去了验证意义。
 * `open` 控件因此表示「初始是否展开」，评审者可以真的点、真的用键盘。
 */

function textProp(props: LabProps, name: string, fallback: string): string {
    const value = props[name];
    return typeof value === "string" ? value : fallback;
}

function booleanProp(props: LabProps, name: string, fallback = false): boolean {
    const value = props[name];
    return typeof value === "boolean" ? value : fallback;
}

function optionProp<T extends string>(
    props: LabProps,
    name: string,
    fallback: T,
    options: readonly T[],
): T {
    const value = props[name];
    return typeof value === "string" && options.includes(value as T)
        ? value as T
        : fallback;
}

function control(
    name: string,
    label: string,
    kind: LabControlDefinition["kind"],
    defaultValue: string | boolean,
    options?: readonly string[],
): LabControlDefinition {
    if (kind === "select") {
        return {name, label, kind, defaultValue: String(defaultValue), options: options ?? []};
    }
    return {name, label, kind, defaultValue};
}

/* ------------------------------------------------------------------ */
/* Controls                                                            */
/* ------------------------------------------------------------------ */

export const dialogControls = [
    control("open", "Initially open", "boolean", false),
    control("title", "Title", "text", "归并到已有 Story"),
    control("description", "Description", "text", "两条内容会合并成一条，原来的记录仍然保留在历史里。"),
] as const satisfies readonly LabControlDefinition[];

export const alertDialogControls = [
    control("open", "Initially open", "boolean", false),
    control("danger", "Danger", "boolean", true),
    control("title", "Title", "text", "删除这个标签？"),
    control("description", "Description", "text", "删除后，这个标签下挂着的 Story 仍然保留，只是不再带这个标签。"),
] as const satisfies readonly LabControlDefinition[];

export const menuControls = [
    control("open", "Initially open", "boolean", false),
    control("disabledItem", "Disabled item", "boolean", false),
] as const satisfies readonly LabControlDefinition[];

export const tabsControls = [
    control("selected", "Selected", "select", "labels", ["labels", "collections", "favorites"]),
] as const satisfies readonly LabControlDefinition[];

export const toastControls = [
    control("open", "Emit", "boolean", true),
    control("variant", "Variant", "select", "success", ["info", "success", "error"]),
    control("title", "Title", "text", "已收藏"),
    control("description", "Description", "text", "可以在信息库顶部的筛选里找到收藏过的内容。"),
] as const satisfies readonly LabControlDefinition[];

export const selectControls = [
    control("open", "Initially open", "boolean", false),
    control("value", "Value", "select", "saved", ["saved", "metadata_only", "skipped", "failed"]),
    control("disabled", "Disabled", "boolean", false),
] as const satisfies readonly LabControlDefinition[];

export const comboboxControls = [
    control("open", "Initially open", "boolean", false),
    control("disabled", "Disabled", "boolean", false),
] as const satisfies readonly LabControlDefinition[];

export const tooltipControls = [
    control("open", "Initially open", "boolean", false),
    control("text", "Text", "text", "依据 3 条 · 置信度 0.72"),
] as const satisfies readonly LabControlDefinition[];

export const systemOutputControls = [
    control("state", "State", "select", "machine", ["machine", "mixed", "empty"]),
] as const satisfies readonly LabControlDefinition[];

/* ------------------------------------------------------------------ */
/* Renderers                                                           */
/* ------------------------------------------------------------------ */

const ASSET_STATUS_LABELS: Record<string, string> = {
    saved: "已保存",
    metadata_only: "仅元数据",
    skipped: "未保存",
    failed: "保存失败",
};

export function renderDialog(props: LabProps): ReactNode {
    return (
        <Dialog defaultOpen={booleanProp(props, "open")}>
            <DialogTrigger render={<Button variant="outline" />}>打开对话框</DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{textProp(props, "title", "归并到已有 Story")}</DialogTitle>
                    <DialogDescription>
                        {textProp(props, "description", "两条内容会合并成一条，原来的记录仍然保留在历史里。")}
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button variant="outline">取消</Button>
                    <Button>归并</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function renderAlertDialog(props: LabProps): ReactNode {
    const danger = booleanProp(props, "danger", true);
    return (
        <AlertDialog defaultOpen={booleanProp(props, "open")}>
            <AlertDialogTrigger render={<Button variant="outline" />}>打开确认框</AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{textProp(props, "title", "删除这个标签？")}</AlertDialogTitle>
                    <AlertDialogDescription>
                        {textProp(props, "description", "删除后，这个标签下挂着的 Story 仍然保留，只是不再带这个标签。")}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction variant={danger ? "destructive" : "default"}>
                        删除
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

export function renderMenu(props: LabProps): ReactNode {
    return (
        <Menu defaultOpen={booleanProp(props, "open")}>
            <MenuTrigger render={<Button variant="outline" />}>更多操作</MenuTrigger>
            <MenuContent>
                <MenuItem>打开 Story</MenuItem>
                <MenuItem disabled={booleanProp(props, "disabledItem")}>加入已有话题</MenuItem>
                <MenuItem>关联已有 Entity</MenuItem>
                <MenuSeparator />
                <MenuItem variant="destructive">移除这个标签</MenuItem>
            </MenuContent>
        </Menu>
    );
}

export function renderTabs(props: LabProps): ReactNode {
    const selected = optionProp(props, "selected", "labels", ["labels", "collections", "favorites"] as const);
    return (
        <Tabs defaultValue={selected}>
            <TabsList>
                <TabsTrigger value="labels">标签</TabsTrigger>
                <TabsTrigger value="collections">收藏夹</TabsTrigger>
                <TabsTrigger value="favorites">收藏</TabsTrigger>
            </TabsList>
            <TabsContent value="labels">
                <p className="text-[13px] text-muted-foreground">标签分区：新建、删除、查看某个标签下的 Story。</p>
            </TabsContent>
            <TabsContent value="collections">
                <p className="text-[13px] text-muted-foreground">收藏夹分区：新建、改名、删除、增删成员。</p>
            </TabsContent>
            <TabsContent value="favorites">
                <p className="text-[13px] text-muted-foreground">收藏分区：查看收藏过的内容并取消收藏。</p>
            </TabsContent>
        </Tabs>
    );
}

function ToastEmitFixture({
    variant,
    props,
}: {
    variant: "info" | "success" | "error";
    props: LabProps;
}): ReactNode {
    const manager = ToastPrimitive.useToastManager();
    const managerRef = useRef(manager);
    managerRef.current = manager;
    const title = textProp(props, "title", "已收藏");
    const description = textProp(props, "description", "可以在信息库顶部的筛选里找到收藏过的内容。");

    // manager 每次渲染都是新引用，放进依赖会让 effect 反复入队并触发
    // 「Maximum update depth exceeded」；用 ref 持有，依赖只留影响内容的字段。
    useEffect(() => {
        managerRef.current.add({
            description,
            title,
            timeout: variant === "error" ? 0 : undefined,
            type: variant,
        });
    }, [description, title, variant]);

    return <ToastHost />;
}

export function renderToast(props: LabProps): ReactNode {
    const variant = optionProp(props, "variant", "success", ["info", "success", "error"] as const);
    return (
        <ToastProvider>
            <div className="text-[13px] text-muted-foreground">回执显示在右下角。</div>
            {booleanProp(props, "open", true) ? (
                <ToastEmitFixture variant={variant} props={props} />
            ) : null}
        </ToastProvider>
    );
}

export function renderSelect(props: LabProps): ReactNode {
    const value = optionProp(props, "value", "saved", ["saved", "metadata_only", "skipped", "failed"] as const);
    return (
        <Select
            defaultOpen={booleanProp(props, "open")}
            defaultValue={value}
            disabled={booleanProp(props, "disabled")}
        >
            <SelectTrigger aria-label="录入状态">
                <SelectValue>{ASSET_STATUS_LABELS[value] ?? value}</SelectValue>
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="saved">已保存</SelectItem>
                <SelectItem value="metadata_only">仅元数据</SelectItem>
                <SelectItem value="skipped">未保存</SelectItem>
                <SelectItem value="failed">保存失败</SelectItem>
            </SelectContent>
        </Select>
    );
}

const COMBOBOX_TOPICS = [
    "Qwen 3.8 Max 发布与后续影响",
    "DeepSeek 定价调整与生态影响",
    "本地部署与小模型量化",
    "长上下文评测方法之争",
];

export function renderCombobox(props: LabProps): ReactNode {
    return (
        <div className="w-full max-w-md">
            <Combobox
                defaultOpen={booleanProp(props, "open")}
                disabled={booleanProp(props, "disabled")}
                items={COMBOBOX_TOPICS}
            >
                <ComboboxInput aria-label="选择话题" placeholder="搜索话题…" />
                <ComboboxContent>
                    <ComboboxEmpty>没有匹配的话题</ComboboxEmpty>
                    <ComboboxList<string>>
                        {(topic) => (
                            <ComboboxItem key={topic} value={topic}>
                                {topic}
                            </ComboboxItem>
                        )}
                    </ComboboxList>
                </ComboboxContent>
            </Combobox>
        </div>
    );
}

export function renderTooltip(props: LabProps): ReactNode {
    return (
        <TooltipProvider>
            {/* 不强制打开时交给 hover/focus 驱动——键盘用户必须能看到同一信息（V4）。 */}
            <Tooltip defaultOpen={booleanProp(props, "open")}>
                <TooltipTrigger render={<Button variant="outline" />}>Agent 建议</TooltipTrigger>
                <TooltipContent>{textProp(props, "text", "依据 3 条 · 置信度 0.72")}</TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}

const SYSTEM_OUTPUT_BASE: FeedItem[] = [
    {
        storyId: "story-system",
        storyKind: "document",
        title: "某开源项目 0.9 版本更新说明",
        summary: null,
        entryId: "entry-system",
        sourceId: "source-a",
        sourceName: "GitHub Releases",
        sourceKind: "rss",
        revisionId: "rev-system",
        publishedAt: "2026-09-22T00:00:00.000Z",
        producer: "system",
        assets: [],
    },
    {
        storyId: "story-agent",
        storyKind: "event",
        title: "Qwen 3.8 Max 发布：官方公告汇总",
        summary: null,
        entryId: "entry-agent",
        sourceId: "source-b",
        sourceName: "AI HOT",
        sourceKind: "rss",
        revisionId: "rev-agent",
        publishedAt: "2026-09-24T00:00:00.000Z",
        producer: "agent",
        assets: [],
    },
    {
        storyId: "story-human",
        storyKind: "document",
        title: "人工改过标题的一条内容",
        summary: null,
        entryId: "entry-human",
        sourceId: "source-a",
        sourceName: "少数派",
        sourceKind: "rss",
        revisionId: "rev-human",
        publishedAt: "2026-09-21T00:00:00.000Z",
        producer: "human",
        assets: [],
    },
];

/** 系统产出区块的三种可观察状态：全部机器产出 / 混合 / 空。 */
export function renderSystemOutput(props: LabProps): ReactNode {
    const state = optionProp(props, "state", "machine", ["machine", "mixed", "empty"] as const);
    const items = state === "empty"
        ? []
        : state === "mixed"
            ? SYSTEM_OUTPUT_BASE
            : SYSTEM_OUTPUT_BASE.filter((item) => item.producer !== "human");
    return (
        <div className="w-full max-w-2xl rounded-[var(--radius-card)] border border-border bg-card p-4">
            <SystemOutputBlock items={items} loading={false} onOpenStory={() => {}} />
        </div>
    );
}
