/**
 * `@cosmos/plugin-collectors` 的门面：只做导出与模块地图，实现见各分册。
 *
 * 导出清单与 `entry-surface.txt` 一致；增删导出必须先重新生成该快照（见 MODULE.md）。
 */
export {
    createNodeOpenCliRunner, openCliExecutableEnv, supportedOpenCliMajor, type OpenCliRunResult, type OpenCliRunOptions, type OpenCliRunner, type OpenCliRunnerOptions,
} from "./opencli-runner.js";
export {
    createBilibiliConnector, createOpenCliConnector, bilibiliConnectorId, type OpenCliConnectorOptions,
} from "./bilibili-connector.js";
export {
    createAiHotConnector, aiHotConnectorId, aiHotItemsUrl, type AiHotConnectorOptions,
} from "./aihot-connector.js";
export {
    createBuiltInConnectorRegistry,
} from "./registry.js";
