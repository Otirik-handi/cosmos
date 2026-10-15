import { Module } from "@nestjs/common";
import { ContentRebuild, ContentCommands, ContentQuery, StoryAgentCandidates } from "@cosmos/application";
import { createBuiltinManifestCatalog } from "@cosmos/application/catalog";
import { MediaCleanupWorkflowControlService } from "@cosmos/application/media-cleanup";
import { IngestWorkflowControlService } from "@cosmos/application/workflow-control";
import { createLogger } from "@cosmos/logging";
import {
    PrismaCosmosRepository,
    PrismaContentQueryRepository,
    PrismaContentRebuildRepository,
    PrismaContentSelectionRepository,
    PrismaStoryAgentCandidateRepository,
    PrismaWorkflowHostStore,
} from "@cosmos/storage-prisma";

import { AppController } from "./app.controller.js";
import { HookController } from "./hook.controller.js";
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
    getCheckpointSnapshot: (planId) => cosmosRepository.getCheckpointSnapshot(planId),
});
export const cosmosContentRebuild = new ContentRebuild(new PrismaContentRebuildRepository(cosmosRepository.prisma, cosmosRepository.blobs));
export const cosmosContentQuery = new ContentQuery(new PrismaContentQueryRepository(cosmosRepository.prisma));
export const cosmosContentCommands = new ContentCommands(new PrismaContentSelectionRepository(cosmosRepository.prisma));
export const cosmosStoryAgentCandidates = new StoryAgentCandidates(new PrismaStoryAgentCandidateRepository(cosmosRepository.prisma));
export const cosmosMediaCleanupControl = new MediaCleanupWorkflowControlService({
    store: cosmosWorkflowStore,
});

@Module({
    controllers: [AppController, HookController],
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
        {
            provide: "COSMOS_MEDIA_CLEANUP_CONTROL",
            useValue: cosmosMediaCleanupControl,
        },
        {
            provide: "COSMOS_CONTENT_QUERY",
            useValue: cosmosContentQuery,
        },
        {
            provide: "COSMOS_CONTENT_COMMANDS",
            useValue: cosmosContentCommands,
        },
        {
            provide: "COSMOS_STORY_AGENT_CANDIDATES",
            useValue: cosmosStoryAgentCandidates,
        },
        {
            provide: "COSMOS_CONTENT_REBUILD",
            useValue: cosmosContentRebuild,
        },
        SourceProbeService,
    ],
})
export class AppModule {}
