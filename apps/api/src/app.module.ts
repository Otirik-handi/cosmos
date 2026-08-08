import { Module } from "@nestjs/common";
import { ConnectorRegistry } from "@cosmos/application";
import { createLogger } from "@cosmos/logging";
import { createBuiltInConnectorRegistry } from "@cosmos/plugin-collectors";
import {
    PrismaCosmosRepository,
} from "@cosmos/storage-prisma";

import { AppController } from "./app.controller.js";
import { SourceProbeService } from "./source-probe.service.js";

export const cosmosLogger = createLogger({
    service: "cosmos-api",
    fileName: "api",
});
export const cosmosRepository = new PrismaCosmosRepository({
    logger: cosmosLogger,
});
export const cosmosConnectorRegistry = createBuiltInConnectorRegistry({
    workspaceRoot: process.env.COSMOS_WORKSPACE_ROOT ?? process.cwd(),
    logger: cosmosLogger,
});

@Module({
    controllers: [AppController],
    providers: [
        {
            provide: PrismaCosmosRepository,
            useValue: cosmosRepository,
        },
        {
            provide: "COSMOS_LOGGER",
            useValue: cosmosLogger,
        },
        {
            provide: ConnectorRegistry,
            useValue: cosmosConnectorRegistry,
        },
        SourceProbeService,
    ],
})
export class AppModule {}
