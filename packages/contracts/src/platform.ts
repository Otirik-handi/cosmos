import { z } from "zod";
import {
    protocolVersion,
} from "./base.js";
import {
    annotationSchema,
    collectionDetailSchema,
    favoriteItemSchema,
    labelDetailSchema,
    savedViewSchema,
} from "./user-organization.js";
import {
    boardDetailSchema,
    spotlightPlacementSchema,
} from "./board.js";

export const storageStatsSchema = z.object({
    databaseBytes: z.number().int().nonnegative(),
    blobBytes: z.number().int().nonnegative(),
    blobFileCount: z.number().int().nonnegative(),
    artifactBytes: z.number().int().nonnegative(),
    cacheBytes: z.number().int().nonnegative(),
    logBytes: z.number().int().nonnegative(),
    secretBytes: z.number().int().nonnegative(),
    categories: z.object({
        raw: z.number().int().nonnegative(),
        user: z.number().int().nonnegative(),
        rebuildable: z.number().int().nonnegative(),
        cleanable: z.number().int().nonnegative(),
    }).strict(),
    snapshotAt: z.string(),
}).strict();

export type StorageStats = z.infer<typeof storageStatsSchema>;

/** A database backup file inside the data root (ADR-0019 / OPS-004). */

export const backupSnapshotSchema = z.object({
    id: z.string(),
    name: z.string(),
    byteSize: z.number().int().nonnegative(),
    createdAt: z.string(),
}).strict();

export type BackupSnapshot = z.infer<typeof backupSnapshotSchema>;

/**
 * 用户数据导出件（LIB-008 / OPS-004）：用户真相对象（ADR-0009/0010）的可带走副本。
 *
 * 只收录用户创作与配置的数据，以及它们引用的目标摘要；采集内容、运行记录、Secret
 * 与内部存储键都不在其中——需要内容库时用 `POST /backups` 的数据库副本。字段直接
 * 复用各对象的公开读投影，导出不新造第二套对象定义。
 */

export const userDataExportTargetSchema = z.object({
    targetType: z.string(),
    targetId: z.string(),
    // 目标已被删除时为 null，引用本身仍然保留，导出件不因悬空引用失败。
    title: z.string().nullable(),
    webUrl: z.string().nullable(),
});

export type UserDataExportTarget = z.infer<typeof userDataExportTargetSchema>;


export const userDataExportSchema = z.object({
    // 唯一版本位：新增分区或改变字段含义时升版本，不改已有字段语义。
    schemaVersion: z.literal(1),
    exportedAt: z.string(),
    counts: z.object({
        labels: z.number().int().nonnegative(),
        collections: z.number().int().nonnegative(),
        favorites: z.number().int().nonnegative(),
        annotations: z.number().int().nonnegative(),
        savedViews: z.number().int().nonnegative(),
        boards: z.number().int().nonnegative(),
        spotlightPlacements: z.number().int().nonnegative(),
        targets: z.number().int().nonnegative(),
    }).strict(),
    data: z.object({
        labels: labelDetailSchema.array(),
        collections: collectionDetailSchema.array(),
        favorites: favoriteItemSchema.array(),
        annotations: annotationSchema.array(),
        savedViews: savedViewSchema.array(),
        boards: boardDetailSchema.array(),
        spotlightPlacements: spotlightPlacementSchema.array(),
        targets: userDataExportTargetSchema.array(),
    }).strict(),
}).strict();

export type UserDataExport = z.infer<typeof userDataExportSchema>;



export const healthResponseSchema = z.object({
    status: z.literal("ok"),
    service: z.string(),
    version: z.string(),
    protocolVersion: z.string(),
    workerStatus: z.enum(["unknown", "starting", "ready", "stopped"]),
    storageStatus: z.enum(["unknown", "starting", "ready", "failed"]),
    migrationStatus: z.enum(["unknown", "pending", "ready", "failed"]),
    timestamp: z.string(),
});


export type HealthResponse = z.infer<typeof healthResponseSchema>;


export const serviceErrorCodeSchema = z.enum([
    "validation_failed",
    "not_found",
    "conflict",
    "service_unavailable",
    "protocol_mismatch",
    "uncertain",
]);


export type ServiceErrorCode = z.infer<typeof serviceErrorCodeSchema>;


export const serviceErrorSchema = z.object({
    code: serviceErrorCodeSchema,
    message: z.string(),
    requestId: z.string().optional(),
    commandId: z.string().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
    retryable: z.boolean(),
});


export type ServiceError = z.infer<typeof serviceErrorSchema>;


export interface EventEnvelope<TPayload> {
    id: string;
    type: string;
    version: string;
    occurredAt: string;
    payload: TPayload;
}


export const eventSnapshotSchema = z.object({
    id: z.string(),
    type: z.string(),
    version: z.string(),
    occurredAt: z.string(),
    payload: z.unknown(),
});

export type EventSnapshot = z.infer<typeof eventSnapshotSchema>;


export const snapshotRequiredPayloadSchema = z.object({
    reason: z.string(),
    latestEventId: z.string(),
});

export type SnapshotRequiredPayload = z.infer<typeof snapshotRequiredPayloadSchema>;


export const sseEventSchema = z.object({
    id: z.string(),
    type: z.string(),
    version: z.string(),
    occurredAt: z.string(),
    payload: z.unknown(),
});

export type SseEvent = z.infer<typeof sseEventSchema>;
