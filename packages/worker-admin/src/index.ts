/**
 * `@cosmos/worker-admin` 的门面：只做导出与模块地图，实现见各分册。
 *
 * 导出清单与 `entry-surface.txt` 一致；增删导出必须先重新生成该快照（见 MODULE.md）。
 */
export {
    WorkerAdminRequestError, type WorkerMode, type ComponentStatus, type FailureSnapshot, type ComponentHealth, type WorkerLaneStatus, type WorkerActiveAttemptSummary, type WorkerLivenessSnapshot, type WorkerReadinessSnapshot, type WorkerStatusSnapshot, type WorkerManifestEvidence, type WorkerCapabilitySnapshot, type WorkerDrainSnapshot, type WorkerAdminLaneConfig, type WorkerAdminOptions, type CreateDrainCommand, type DrainDecision,
} from "./types.js";
export {
    createWorkerAdminServer, type WorkerAdminServerOptions, type WorkerAdminServer,
} from "./http.js";
export {
    WorkerAdminService,
} from "./service.js";
