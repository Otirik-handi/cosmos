import { z } from "zod";
import {
    protocolVersion,
} from "./base.js";

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
