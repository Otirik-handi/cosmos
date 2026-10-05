import type {ReactNode} from "react";

import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Field,
    FieldDescription,
    FieldLabel,
} from "@/components/ui/field";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Separator} from "@/components/ui/separator";
import {Textarea} from "@/components/ui/textarea";

import type {LabProps} from "../types";
import {
    badgeVariants,
    booleanProp,
    buttonSizes,
    buttonVariants,
    cardSizes,
    optionProp,
    orientations,
    textProp,
} from "./shared";

export function renderButton(props: LabProps): ReactNode {
    const variant = optionProp(props, "variant", "default", buttonVariants);
    const size = optionProp(props, "size", "default", buttonSizes);
    return (
        <Button
            disabled={booleanProp(props, "disabled")}
            size={size}
            variant={variant}
        >
            {textProp(props, "label", "Button")}
        </Button>
    );
}

export function renderBadge(props: LabProps): ReactNode {
    const variant = optionProp(props, "variant", "default", badgeVariants);
    return <Badge variant={variant}>{textProp(props, "label", "Badge")}</Badge>;
}

export function renderCard(props: LabProps): ReactNode {
    const size = optionProp(props, "size", "default", cardSizes);
    return (
        <Card size={size} className="w-full max-w-md">
            <CardHeader>
                <CardTitle>{textProp(props, "title", "Card title")}</CardTitle>
                <CardDescription>
                    {textProp(props, "description", "Card description")}
                </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
                A stable card fixture for spacing, hierarchy, and long text.
            </CardContent>
        </Card>
    );
}

export function renderField(props: LabProps): ReactNode {
    const invalid = booleanProp(props, "invalid");
    return (
        <Field data-invalid={invalid} className="w-full max-w-md">
            <FieldLabel htmlFor="component-lab-field">
                {textProp(props, "label", "Field label")}
            </FieldLabel>
            <Input
                id="component-lab-field"
                aria-invalid={invalid}
                disabled={booleanProp(props, "disabled")}
                placeholder={textProp(props, "placeholder", "Type something")}
                readOnly
                value={textProp(props, "value", "Preview value")}
            />
            <FieldDescription>
                {invalid ? "This field contains an error." : "Supporting field description."}
            </FieldDescription>
        </Field>
    );
}

export function renderInput(props: LabProps): ReactNode {
    const invalid = booleanProp(props, "invalid");
    return (
        <Input
            aria-invalid={invalid}
            className="max-w-md"
            disabled={booleanProp(props, "disabled")}
            placeholder={textProp(props, "placeholder", "Type something")}
            readOnly
            value={textProp(props, "value", "Preview value")}
        />
    );
}

export function renderLabel(props: LabProps): ReactNode {
    return <Label htmlFor="component-lab-label-input">{textProp(props, "label", "Label")}</Label>;
}

export function renderSeparator(props: LabProps): ReactNode {
    const orientation = optionProp(props, "orientation", "horizontal", orientations);
    if (orientation === "vertical") {
        return <Separator orientation="vertical" className="h-12" />;
    }
    /*
     * 横向线演示整宽并给上下配文字：分隔线的合同是「两块内容之间的整宽色带」，
     * 只渲染一根短横线看不出它在真实面板里的宽度与重量（维护者 2026-10-03 反馈
     * 「太短、看不出实际效果」，此前这里是 `max-w-md`）。
     */
    return (
        <div className="flex w-full flex-col gap-3 text-sm">
            <p className="text-muted-foreground">上一段内容的最后一行文字。</p>
            <Separator data-lab-separator="true" />
            <p className="text-muted-foreground">下一段内容的第一行文字。</p>
        </div>
    );
}

export function renderTextarea(props: LabProps): ReactNode {
    const invalid = booleanProp(props, "invalid");
    return (
        <Textarea
            aria-invalid={invalid}
            className="max-w-md"
            disabled={booleanProp(props, "disabled")}
            placeholder={textProp(props, "placeholder", "Type something")}
            readOnly
            value={textProp(props, "value", "Preview value")}
        />
    );
}
