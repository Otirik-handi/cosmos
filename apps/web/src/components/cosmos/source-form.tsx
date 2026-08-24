import type {FormEventHandler} from "react";
import type {UseFormReturn} from "react-hook-form";
import {z} from "zod";

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
import {Textarea} from "@/components/ui/textarea";

export const sourceFormSchema = z.object({
    name: z.string().trim().min(1).max(200),
    feedUrl: z.string().trim().url(),
});

export type SourceFormValues = z.input<typeof sourceFormSchema>;

type SourceFormProps = {
    form: UseFormReturn<SourceFormValues>;
    onSubmit: FormEventHandler<HTMLFormElement>;
};

export function SourceForm({form, onSubmit}: SourceFormProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>新建 RSS 来源</CardTitle>
                <CardDescription>
                    先填写真实 RSS/Atom Feed URL；来源创建后默认停用，确认配置后才会启用。
                </CardDescription>
            </CardHeader>
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
                        <Field data-invalid={Boolean(form.formState.errors.feedUrl)}>
                            <FieldLabel htmlFor="source-feed-url">Feed URL</FieldLabel>
                            <Input
                                id="source-feed-url"
                                type="url"
                                placeholder="https://example.com/feed.xml"
                                aria-invalid={Boolean(form.formState.errors.feedUrl)}
                                {...form.register("feedUrl")}
                            />
                            <FieldError errors={[form.formState.errors.feedUrl]} />
                        </Field>
                    </FieldGroup>
                </CardContent>
                <CardFooter>
                    <Button type="submit" disabled={form.formState.isSubmitting}>
                        {form.formState.isSubmitting ? "保存中…" : "保存来源"}
                    </Button>
                </CardFooter>
            </form>
        </Card>
    );
}
