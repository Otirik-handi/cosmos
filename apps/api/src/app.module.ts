import { Module } from "@nestjs/common";
import { createBuiltinManifestCatalog } from "@cosmos/application/catalog";
import { IngestWorkflowControlService } from "@cosmos/application/workflow-control";
import { createLogger } from "@cosmos/logging";
import {
    PrismaCosmosRepository,
    PrismaWorkflowHostStore,
} from "@cosmos/storage-prisma";

import { AppController } from "./app.controller.js";
import { SourceProbeService } from "./source-probe.service.js";

export const cosmosLogger = createLogger({
    service: "cosmos-api",
    fileName: "api",
});
export const cosmosCatalog = createBuiltinManifestCatalog();
export const cosmosRepository = new PrismaCosmosRepository({
    logger: cosmosLogger,
    catalog: cosmosCatalog,
});
export const cosmosWorkflowStore = new PrismaWorkflowHostStore(cosmosRepository.prisma, {
    logger: cosmosLogger,
});
export const cosmosIngestControl = new IngestWorkflowControlService({
    store: cosmosWorkflowStore,
    getSourceExecutionSnapshot: async (sourceId) => {
        const source = await cosmosRepository.getSource(sourceId);
        return source ?? null;
    },
    getCheckpointSnapshot: (sourceId) => cosmosRepository.getCheckpointSnapshot(sourceId),
});

@Module({
    controllers: [AppController],
    providers: [
        {
            provide: "COSMOS_PRODUCT_PORT",
            useValue: cosmosRepository,
        },
        {
            provide: "COSMOS_LOGGER",
            useValue: cosmosLogger,
        },
        {
            provide: "COSMOS_CATALOG",
            useValue: cosmosCatalog,
        },
        {
            provide: "COSMOS_WORKFLOW_CONTROL",
            useValue: cosmosIngestControl,
        },
        {
            provide: "COSMOS_WORKFLOW_STORE",
            useValue: cosmosWorkflowStore,
        },
        SourceProbeService,
    ],
})
export class AppModule {}
