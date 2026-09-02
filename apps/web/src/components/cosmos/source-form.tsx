import type {FormEventHandler} from "react";
import type {UseFormReturn} from "react-hook-form";
import {RotateCcw} from "lucide-react";
import {z} from "zod";

import type {
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

export const sourceFormSchema = z.object({
    name: z.string().trim().min(1, "请填写来源名称。").max(200, "来源名称不能超过 200 字符。"),
    feedUrl: z.string()
        .trim()
        .min(1, "请填写 Feed URL。")
        .url("请填写合法的 URL。")
        .refine((value) => {
            try {
                return /^https?:$/i.test(new URL(value).protocol);
            } catch {
                return false;
            }
        }, {message: "Feed URL 必须是 http(s) 链接。"}),
    scheduleIntervalMinutes: z.union([
        z.literal(""),
        z.coerce.number()
            .int("定时抓取间隔必须是整数分钟。")
            .min(1, "定时抓取间隔至少 1 分钟。")
            .max(44_640, "定时抓取间隔不能超过 31 天。"),
    ]),
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
    | {status: "ready"; manifest: SourceDefinitionManifest}
    | {status: "error"; message: string};

type SourceFormProps = {
    form: UseFormReturn<SourceFormValues>;
    definitionState: SourceDefinitionState;
    onSubmit: FormEventHandler<HTMLFormElement>;
    onTest: () => void;
    probeState: ProbeState;
    onRetryDefinition: () => void;
};

type ManifestField = {
    name: string;
    kind: "text" | "number";
    required: boolean;
};

/**
 * Read the descriptive JSON Schema out of a source definition manifest so the
 * form fields follow the catalog instead of a hardcoded per-kind list. Fields
 * outside string/integer stay unrendered rather than guessed.
 */
function readManifestFields(manifest: SourceDefinitionManifest): ManifestField[] {
    const schema = manifest.configurationSchema.schema;
    const properties = schema?.properties;
    if (!properties || typeof properties !== "object") {
        return [];
    }
    const required = Array.isArray(schema?.required)
        ? schema.required.filter((item): item is string => typeof item === "string")
        : [];
    return Object.entries(properties)
        .filter(([, raw]) => {
            if (!raw || typeof raw !== "object") {
                return false;
            }
            const type = (raw as {type?: unknown}).type;
            return type === "string" || type === "integer";
        })
        .map(([name, raw]) => ({
            name,
            kind: (raw as {type: string}).type === "integer" ? "number" : "text",
            required: required.includes(name),
        }));
}

/** UI presentation per known config field; unknown fields fall back to plain text. */
const fieldPresentation: Record<string, {label: string; type?: string; placeholder?: string; description?: string}> = {
    feedUrl: {
        label: "Feed URL",
        type: "url",
        placeholder: "https://example.com/feed.xml",
    },
    scheduleIntervalMs: {
        label: "定时抓取间隔（分钟）",
        type: "number",
        placeholder: "30",
        description: "保存后按此间隔自动抓取；留空表示不自动抓取。",
    },
};

export function SourceForm({
    form,
    definitionState,
    onSubmit,
    onTest,
    probeState,
    onRetryDefinition,
}: SourceFormProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>新建 RSS 来源</CardTitle>
                <CardDescription>
                    按 RSS 来源定义填写配置；可先测试未保存配置，再保存为停用来源。
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
                            <Field data-invalid={Boolean(form.formState.errors.name)}>
                                <FieldLabel htmlFor="source-name">名称</FieldLabel>
                                <Input
                                    id="source-name"
                                    aria-invalid={Boolean(form.formState.errors.name)}
                                    {...form.register("name")}
                                />
                                <FieldError errors={[form.formState.errors.name]} />
                            </Field>
                            {readManifestFields(definitionState.manifest).map((field) => {
                                if (field.name === "scheduleIntervalMs") {
                                    return (
                                        <Field
                                            key={field.name}
                                            data-invalid={Boolean(form.formState.errors.scheduleIntervalMinutes)}
                                        >
                                            <FieldLabel htmlFor="source-schedule-interval">
                                                {fieldPresentation.scheduleIntervalMs?.label ?? field.name}
                                                {!field.required && <span className="text-muted-foreground">（可选）</span>}
                                            </FieldLabel>
                                            <Input
                                                id="source-schedule-interval"
                                                type={fieldPresentation.scheduleIntervalMs?.type ?? "text"}
                                                placeholder={fieldPresentation.scheduleIntervalMs?.placeholder}
                                                aria-invalid={Boolean(form.formState.errors.scheduleIntervalMinutes)}
                                                {...form.register("scheduleIntervalMinutes")}
                                            />
                                            <FieldDescription>
                                                {fieldPresentation.scheduleIntervalMs?.description}
                                            </FieldDescription>
                                            <FieldError errors={[form.formState.errors.scheduleIntervalMinutes]} />
                                        </Field>
                                    );
                                }
                                const presentation = fieldPresentation[field.name];
                                return (
                                    <Field
                                        key={field.name}
                                        data-invalid={Boolean(form.formState.errors[field.name as "feedUrl"])}
                                    >
                                        <FieldLabel htmlFor={`source-config-${field.name}`}>
                                            {presentation?.label ?? field.name}
                                            {!field.required && <span className="text-muted-foreground">（可选）</span>}
                                        </FieldLabel>
                                        <Input
                                            id={`source-config-${field.name}`}
                                            type={presentation?.type ?? "text"}
                                            placeholder={presentation?.placeholder}
                                            aria-invalid={Boolean(form.formState.errors[field.name as "feedUrl"])}
                                            {...form.register(field.name as "feedUrl")}
                                        />
                                        <FieldError errors={[form.formState.errors[field.name as "feedUrl"]]} />
                                    </Field>
                                );
                            })}
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
                        <Button type="submit" disabled={form.formState.isSubmitting}>
                            {form.formState.isSubmitting ? "保存中…" : "保存来源（停用）"}
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
