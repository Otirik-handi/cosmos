import type {FormEventHandler} from "react";
import type {UseFormReturn} from "react-hook-form";
import {RotateCcw} from "lucide-react";
import {z} from "zod";

import type {
    ConnectionInstance,
    SourceConfigProbeResult,
    SourceDefinitionManifest,
} from "@cosmos/contracts";

import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Field,
    FieldDescription,
    FieldError,
    FieldGroup,
    FieldLabel,
} from "@/components/ui/field";
import {Input} from "@/components/ui/input";

/**
 * 表单只校验它能自己判断的部分（名称、定时、连接）；目标配置的每个字段由所选
 * manifest 的 JSON Schema 驱动，逐字段校验见 `validateManifestFields`，更细的规则
 * （例如 Bilibili 的「mode=feed 才需要 profile」）由服务端 canonical schema 裁决。
 */
export const sourceFormSchema = z.object({
    name: z.string().trim().min(1, "请填写来源名称。").max(200, "来源名称不能超过 200 字符。"),
    scheduleIntervalMinutes: z.union([
        z.literal(""),
        z.coerce.number()
            .int("定时抓取间隔必须是整数分钟。")
            .min(1, "定时抓取间隔至少 1 分钟。")
            .max(44_640, "定时抓取间隔不能超过 31 天。"),
    ]),
    /** 空串表示不绑定连接（未认证来源）。连接归计划（ADR-0023 决策 2）。 */
    connectionId: z.string(),
    /**
     * 目标配置字段值，键与所选来源定义 JSON Schema 的属性名一一对应，值统一为字符串
     * （数字与枚举在提交时按字段类型转换）。切换来源定义时整组重置。
     */
    config: z.record(z.string(), z.string()),
});

export type SourceFormValues = z.input<typeof sourceFormSchema>;

export type ProbeState =
    | {status: "idle"}
    | {status: "running"}
    | {status: "succeeded"; result: SourceConfigProbeResult}
    | {status: "failed"; message: string}
    | {status: "timeout"};

export type SourceDefinitionState =
    | {status: "loading"}
    | {status: "ready"; manifests: readonly SourceDefinitionManifest[]}
    | {status: "error"; message: string};

type SourceFormProps = {
    form: UseFormReturn<SourceFormValues>;
    definitionState: SourceDefinitionState;
    /** 当前选中的来源定义 ref；未选中或目录里没有时表单不渲染字段。 */
    selectedDefinitionRef: string;
    onSelectDefinition: (ref: string) => void;
    onSubmit: FormEventHandler<HTMLFormElement>;
    onTest: () => void;
    probeState: ProbeState;
    onRetryDefinition: () => void;
    /** 可绑定的连接（ADR-0017）；空列表时只显示「不绑定」。 */
    connections: readonly ConnectionInstance[];
};

export type ManifestField = {
    name: string;
    kind: "text" | "number" | "select";
    required: boolean;
    options: readonly string[];
    minimum: number | null;
    maximum: number | null;
};

/**
 * 从来源定义的描述性 JSON Schema 读出表单字段：`enum` → 选择框、`integer`/`number` →
 * 数字、`string` → 文本。三种以外不渲染，也不猜类型——Bilibili 的 `mode` 只有 `enum`
 * 没有 `type`，按类型白名单过滤会把它整条丢掉，必填的采集模式就再也选不出来。
 */
export function readManifestFields(manifest: SourceDefinitionManifest): ManifestField[] {
    const schema = manifest.configurationSchema.schema;
    const properties = schema?.properties;
    if (!properties || typeof properties !== "object") {
        return [];
    }
    const required = Array.isArray(schema?.required)
        ? schema.required.filter((item): item is string => typeof item === "string")
        : [];
    const fields: ManifestField[] = [];
    for (const [name, raw] of Object.entries(properties)) {
        if (!raw || typeof raw !== "object") {
            continue;
        }
        const property = raw as {type?: unknown; enum?: unknown; minimum?: unknown; maximum?: unknown};
        const options = Array.isArray(property.enum)
            ? property.enum.filter((item): item is string => typeof item === "string")
            : [];
        const kind = options.length > 0
            ? "select"
            : property.type === "integer" || property.type === "number"
            ? "number"
            : property.type === "string"
            ? "text"
            : null;
        if (!kind) {
            continue;
        }
        fields.push({
            name,
            kind,
            required: required.includes(name),
            options,
            minimum: typeof property.minimum === "number" ? property.minimum : null,
            maximum: typeof property.maximum === "number" ? property.maximum : null,
        });
    }
    return fields;
}

/**
 * 客户端能自行判断的字段校验（必填、整数、范围、枚举取值）。返回「字段名 → 消息」。
 * 这里不复制服务端的条件规则：JSON Schema 表达不了 Bilibili 的「mode=feed 才需要
 * profile」，硬猜会在合法输入上误报。
 */
export function validateManifestFields(
    fields: readonly ManifestField[],
    values: Readonly<Record<string, string>>,
): Record<string, string> {
    const errors: Record<string, string> = {};
    for (const field of fields) {
        const raw = (values[field.name] ?? "").trim();
        const label = fieldPresentation[field.name]?.label ?? field.name;
        if (raw === "") {
            if (field.required) {
                errors[field.name] = `请填写${label}。`;
            }
            continue;
        }
        if (field.kind === "select" && !field.options.includes(raw)) {
            errors[field.name] = `${label}只能是：${field.options.join(" / ")}。`;
            continue;
        }
        if (field.kind === "number") {
            if (!/^-?\d+$/u.test(raw)) {
                errors[field.name] = `${label}必须是整数。`;
                continue;
            }
            const value = Number(raw);
            if (field.minimum !== null && value < field.minimum) {
                errors[field.name] = `${label}不能小于 ${field.minimum}。`;
                continue;
            }
            if (field.maximum !== null && value > field.maximum) {
                errors[field.name] = `${label}不能大于 ${field.maximum}。`;
            }
        }
    }
    return errors;
}

/** 按字段类型把表单里的字符串转成 config 值；空值不写进 config。 */
export function toConfigFromFields(
    fields: readonly ManifestField[],
    values: Readonly<Record<string, string>>,
): Record<string, unknown> {
    const config: Record<string, unknown> = {};
    for (const field of fields) {
        const raw = (values[field.name] ?? "").trim();
        if (raw === "") {
            continue;
        }
        config[field.name] = field.kind === "number" ? Number(raw) : raw;
    }
    return config;
}

/**
 * 已知字段的展示文案；未知字段回退到属性名。`optionLabels` 只影响枚举的显示值，
 * 提交的仍是 manifest 声明的原值。
 */
const fieldPresentation: Record<string, {
    label: string;
    type?: string;
    placeholder?: string;
    description?: string;
    optionLabels?: Record<string, string>;
}> = {
    feedUrl: {
        label: "Feed URL",
        type: "url",
        placeholder: "https://example.com/feed.xml",
    },
    mode: {
        label: "采集模式",
        optionLabels: {hot: "热门", feed: "动态"},
    },
    profile: {
        label: "OpenCLI Profile",
        placeholder: "chrome-main",
        description: "采集动态时需要；与浏览器里已登录的 OpenCLI profile 同名。",
    },
    limit: {
        label: "每次条数",
        type: "number",
        placeholder: "20",
    },
};

export function SourceForm({
    form,
    definitionState,
    selectedDefinitionRef,
    onSelectDefinition,
    onSubmit,
    onTest,
    probeState,
    onRetryDefinition,
    connections,
}: SourceFormProps) {
    const manifests = definitionState.status === "ready" ? definitionState.manifests : [];
    const manifest = manifests.find((item) => item.ref === selectedDefinitionRef) ?? null;
    const fields = manifest ? readManifestFields(manifest) : [];

    return (
        <Card>
            <CardHeader>
                <CardTitle>新建采集计划</CardTitle>
                <CardDescription>
                    一个计划 = 一个采集目标 + 它自己的频率、媒体预算与游标。先选来源定义，
                    再按它的声明填配置；可先测试未保存配置，再保存为停用计划。
                </CardDescription>
            </CardHeader>
            {definitionState.status === "error" ? (
                <CardContent className="flex flex-col gap-3">
                    <div
                        role="alert"
                        className="rounded-[var(--radius-control)] border border-destructive/30 bg-destructive/10 p-3 text-sm leading-6 text-destructive"
                    >
                        无法读取来源定义：{definitionState.message}
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={onRetryDefinition}
                    >
                        <RotateCcw data-icon="inline-start" />
                        重试读取
                    </Button>
                </CardContent>
            ) : definitionState.status === "loading" ? (
                <CardContent>
                    <p className="text-sm leading-6 text-muted-foreground" role="status">
                        正在读取来源定义…
                    </p>
                </CardContent>
            ) : (
                <form onSubmit={onSubmit}>
                    <CardContent>
                        <FieldGroup>
                            <Field>
                                <FieldLabel htmlFor="source-definition">来源定义</FieldLabel>
                                <select
                                    id="source-definition"
                                    className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
                                    value={selectedDefinitionRef}
                                    onChange={(event) => onSelectDefinition(event.target.value)}
                                >
                                    {manifests.map((item) => (
                                        <option key={item.ref} value={item.ref}>
                                            {item.displayName}
                                        </option>
                                    ))}
                                </select>
                                <FieldDescription>
                                    {manifest?.description ?? "目录里没有可用的来源定义。"}
                                </FieldDescription>
                            </Field>
                            <Field data-invalid={Boolean(form.formState.errors.name)}>
                                <FieldLabel htmlFor="source-name">名称</FieldLabel>
                                <Input
                                    id="source-name"
                                    aria-invalid={Boolean(form.formState.errors.name)}
                                    {...form.register("name")}
                                />
                                <FieldError errors={[form.formState.errors.name]} />
                            </Field>
                            {manifest && manifest.auth.kind !== "none" && (
                                <div
                                    role="status"
                                    data-source-auth={manifest.auth.kind}
                                    className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border bg-muted/40 p-3 text-xs leading-5"
                                >
                                    <Badge variant="secondary">需要认证</Badge>
                                    <span>
                                        {manifest.auth.label ?? "该来源需要外部登录态"}
                                        {manifest.auth.secretRefRequired ? "（需要凭据）" : ""}
                                        ：在「连接」里绑定后即可复用，这里不填凭证。
                                    </span>
                                </div>
                            )}
                            {fields.map((field) => {
                                const presentation = fieldPresentation[field.name];
                                const error = form.formState.errors.config?.[field.name];
                                return (
                                    <Field
                                        key={field.name}
                                        data-invalid={Boolean(error)}
                                    >
                                        <FieldLabel htmlFor={`source-config-${field.name}`}>
                                            {presentation?.label ?? field.name}
                                            {!field.required && <span className="text-muted-foreground">（可选）</span>}
                                        </FieldLabel>
                                        {field.kind === "select" ? (
                                            <select
                                                id={`source-config-${field.name}`}
                                                className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
                                                aria-invalid={Boolean(error)}
                                                {...form.register(`config.${field.name}` as const)}
                                            >
                                                {/* 必填枚举也留一个空选项：静默取第一个值会让用户
                                                    在没选的情况下采集成另一种模式（如 Bilibili 的热门 vs 动态）。 */}
                                                <option value="">
                                                    {field.required ? "请选择…" : "（未选择）"}
                                                </option>
                                                {field.options.map((option) => (
                                                    <option key={option} value={option}>
                                                        {presentation?.optionLabels?.[option] ?? option}
                                                    </option>
                                                ))}
                                            </select>
                                        ) : (
                                            <Input
                                                id={`source-config-${field.name}`}
                                                type={field.kind === "number" ? "number" : presentation?.type ?? "text"}
                                                placeholder={presentation?.placeholder}
                                                aria-invalid={Boolean(error)}
                                                {...form.register(`config.${field.name}` as const)}
                                            />
                                        )}
                                        {presentation?.description && (
                                            <FieldDescription>{presentation.description}</FieldDescription>
                                        )}
                                        <FieldError errors={[error]} />
                                    </Field>
                                );
                            })}
                            <Field data-invalid={Boolean(form.formState.errors.scheduleIntervalMinutes)}>
                                <FieldLabel htmlFor="source-schedule-interval">
                                    定时抓取间隔（分钟）<span className="text-muted-foreground">（可选）</span>
                                </FieldLabel>
                                <Input
                                    id="source-schedule-interval"
                                    type="number"
                                    placeholder="30"
                                    aria-invalid={Boolean(form.formState.errors.scheduleIntervalMinutes)}
                                    {...form.register("scheduleIntervalMinutes")}
                                />
                                <FieldDescription>
                                    保存后按此间隔自动抓取；留空表示不自动抓取。
                                </FieldDescription>
                                <FieldError errors={[form.formState.errors.scheduleIntervalMinutes]} />
                            </Field>
                            <Field>
                                <FieldLabel htmlFor="source-connection">
                                    连接<span className="text-muted-foreground">（可选）</span>
                                </FieldLabel>
                                <select
                                    id="source-connection"
                                    className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
                                    {...form.register("connectionId")}
                                >
                                    <option value="">不绑定连接</option>
                                    {connections.map((connection) => (
                                        <option key={connection.id} value={connection.id}>
                                            {connection.name}（{connection.connectorId}）
                                        </option>
                                    ))}
                                </select>
                                <FieldDescription>
                                    绑定后可复用该连接的登录状态；同一连接下可以建多个计划。
                                </FieldDescription>
                            </Field>
                            <ProbeFeedback probeState={probeState} />
                        </FieldGroup>
                    </CardContent>
                    <CardFooter className="flex-wrap gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            disabled={probeState.status === "running" || form.formState.isSubmitting}
                            onClick={onTest}
                        >
                            {probeState.status === "running" ? "测试中…" : "测试配置"}
                        </Button>
                        <Button type="submit" disabled={form.formState.isSubmitting || !manifest}>
                            {form.formState.isSubmitting ? "保存中…" : "保存计划（停用）"}
                        </Button>
                    </CardFooter>
                </form>
            )}
        </Card>
    );
}

function ProbeFeedback({probeState}: {probeState: ProbeState}) {
    if (probeState.status === "idle") {
        return null;
    }
    if (probeState.status === "running") {
        return (
            <div
                role="status"
                className="rounded-[var(--radius-control)] border bg-muted/40 p-3 text-sm leading-6"
            >
                正在抓取一页真实内容进行测试，这可能需要几秒钟…
            </div>
        );
    }
    if (probeState.status === "timeout") {
        return (
            <div
                role="alert"
                className="rounded-[var(--radius-control)] border border-amber-500/40 bg-amber-500/10 p-3 text-sm leading-6"
            >
                测试超时：探测任务仍在执行。可以稍后再次点击“测试配置”。
            </div>
        );
    }
    if (probeState.status === "failed") {
        return (
            <div
                role="alert"
                className="rounded-[var(--radius-control)] border border-destructive/30 bg-destructive/10 p-3 text-sm leading-6 text-destructive"
            >
                测试失败：{probeState.message}
            </div>
        );
    }
    const {result} = probeState;
    return (
        <div
            role="status"
            className="flex flex-col gap-2 rounded-[var(--radius-control)] border bg-muted/40 p-3 text-sm leading-6"
        >
            <div className="flex items-center gap-2">
                <Badge variant="secondary">测试成功</Badge>
                <span>
                    抓取到 {result.itemCount} 条内容，耗时 {(result.durationMs / 1000).toFixed(1)} 秒。
                </span>
            </div>
            {result.sampleTitles.length > 0 && (
                <ul className="ml-4 list-disc space-y-1">
                    {result.sampleTitles.map((title) => (
                        <li key={title} className="min-w-0 break-words">
                            {title}
                        </li>
                    ))}
                </ul>
            )}
            {result.nextCursorAvailable && (
                <span className="text-muted-foreground">
                    来源还有更多内容，保存并启用后可持续分页抓取。
                </span>
            )}
        </div>
    );
}
