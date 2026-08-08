import { Module } from "@nestjs/common";
import {
    PrismaCosmosRepository,
} from "@cosmos/storage-prisma";

import { AppController } from "./app.controller.js";
import { SourceProbeService } from "./source-probe.service.js";

export const cosmosRepository = new PrismaCosmosRepository();

@Module({
    controllers: [AppController],
    providers: [
        {
            provide: PrismaCosmosRepository,
            useValue: cosmosRepository,
        },
        SourceProbeService,
    ],
})
export class AppModule {}
