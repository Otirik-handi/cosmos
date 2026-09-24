/**
 * `@cosmos/domain` 的门面：只做导出与模块地图，实现见各分册。
 *
 * `internal.ts` 刻意不被重新导出——它是跨分册共用的非导出助手，不进公共合同。
 */
export * from "./story-subtypes.js";
export * from "./enums.js";
export * from "./content.js";
export * from "./temporal.js";
export * from "./story-representation.js";
export * from "./revision-fingerprints.js";
export * from "./story-projection.js";
