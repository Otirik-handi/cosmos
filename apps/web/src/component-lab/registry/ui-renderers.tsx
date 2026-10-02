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
    return <Separator orientation={orientation} className={orientation === "vertical" ? "h-12" : "w-full max-w-md"} />;
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
