import { PrismaCosmosRepositoryBoardContent } from "./repository/board-content.js";
import type { CosmosRepository } from "@cosmos/application";

export class PrismaCosmosRepository extends PrismaCosmosRepositoryBoardContent implements CosmosRepository {}

export { PrismaWorkflowBackend } from "./workflow-backend.js";
export { PrismaWorkflowHostStore } from "./workflow-host-store.js";
export { PrismaWorkflowEventSink } from "./workflow-event-sink.js";
export { FileSecretStore } from "./secret-store.js";
export { PrismaConnectorStateStore } from "./connector-state-store.js";

export { type StorageRoots, resolveStorageRoots, createPrismaClient, resolveContainedPath } from "./storage-root.js";
