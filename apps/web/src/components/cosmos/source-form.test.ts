import { describe, expect, it } from "vitest";

import { toConfigFromFields, validateManifestFields, type ManifestField } from "@/components/cosmos/source-form";

/**
 * 浏览器用例 `collection-plan-connectors.spec.ts:128` 断的是「必填枚举留空 → 保存被拒」，
 * 但那条用例依赖整页渲染。这里直接钉住它背后的两个纯函数：留空的必填枚举必须报错，
 * 且不能以任何值进 config——否则用户没选采集模式就会按另一种模式采集。
 */
const modeField: ManifestField = {
    name: "mode",
    kind: "select",
    required: true,
    options: ["hot", "feed"],
    minimum: null,
    maximum: null,
};

const limitField: ManifestField = {
    name: "limit",
    kind: "number",
    required: false,
    options: [],
    minimum: 1,
    maximum: 100,
};

describe("source form config fields", () => {
    it("reports an error for an empty required enum", () => {
        const emptyValues: Record<string, string>[] = [{}, { mode: "" }, { mode: "   " }];
        for (const values of emptyValues) {
            const errors = validateManifestFields([modeField], values);
            expect(Object.keys(errors)).toEqual(["mode"]);
            expect(errors.mode).toBeTruthy();
        }
    });

    it("keeps an empty enum out of the submitted config", () => {
        expect(toConfigFromFields([modeField, limitField], {})).toEqual({});
        expect(toConfigFromFields([modeField, limitField], { mode: "", limit: "" })).toEqual({});
    });

    it("passes once the required enum is filled", () => {
        expect(validateManifestFields([modeField], { mode: "hot" })).toEqual({});
        expect(toConfigFromFields([modeField, limitField], { mode: "feed", limit: "5" }))
            .toEqual({ mode: "feed", limit: 5 });
    });
});
