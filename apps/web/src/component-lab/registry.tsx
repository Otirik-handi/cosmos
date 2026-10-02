import type {LabComponentDefinition} from "./types";
import {cosmosComponentDefinitions} from "./registry/definitions-cosmos";
import {uiComponentDefinitions} from "./registry/definitions-ui";

export {labTokenDefinitions} from "./tokens";

/**
 * 组件实验室的总登记表：primitive 与 Cosmos 产品组件两组拼装。
 * registry.test.ts 要求它与 components/{ui,cosmos} 顶层的每个 .tsx 一一对应，
 * 因此新增公共组件时必须同时在这里登记并给出至少一个场景。
 */
export const labComponentDefinitions = [
    ...uiComponentDefinitions,
    ...cosmosComponentDefinitions,
] as const satisfies readonly LabComponentDefinition[];
