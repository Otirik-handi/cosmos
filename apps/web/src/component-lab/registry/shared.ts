import type {ComponentProps} from "react";

import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";

import type {LabControlDefinition, LabProps} from "../types";

export const sharedTokens = [
    "--background",
    "--card",
    "--paper",
    "--foreground",
    "--muted",
    "--muted-foreground",
    "--primary",
    "--primary-foreground",
    "--marker",
    "--marker-soft",
    "--border",
    "--destructive",
    "--radius-control",
    "--radius-card",
    "--divider-thickness",
] as const;

export const buttonVariants = [
    "default",
    "destructive",
    "ghost",
    "link",
    "outline",
    "secondary",
] as const satisfies readonly NonNullable<ComponentProps<typeof Button>["variant"]>[];

export const buttonSizes = [
    "default",
    "lg",
    "sm",
    "xs",
] as const satisfies readonly NonNullable<ComponentProps<typeof Button>["size"]>[];

export const badgeVariants = [
    "default",
    "destructive",
    "ghost",
    "link",
    "outline",
    "secondary",
] as const satisfies readonly NonNullable<ComponentProps<typeof Badge>["variant"]>[];

export const cardSizes = ["default", "sm"] as const;
export const orientations = ["horizontal", "vertical"] as const;

export function textProp(props: LabProps, name: string, fallback: string): string {
    const value = props[name];
    return typeof value === "string" ? value : fallback;
}

export function booleanProp(props: LabProps, name: string, fallback = false): boolean {
    const value = props[name];
    return typeof value === "boolean" ? value : fallback;
}

export function optionProp<T extends string>(
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

export function control(
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
