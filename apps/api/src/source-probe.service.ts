import { Inject, Injectable } from "@nestjs/common";

import type { CatalogPort } from "@cosmos/application/catalog";
import {
    sourceConfigSchema,
    type ConnectorDescriptor,
    type CreateSourceCommand,
} from "@cosmos/contracts";

@Injectable()
export class SourceProbeService {
    constructor(
        @Inject("COSMOS_CATALOG")
        private readonly catalog: CatalogPort,
    ) {}

    list(): readonly ConnectorDescriptor[] {
        return this.catalog.listConnectors();
    }

    validate(input: CreateSourceCommand): void {
        if (!this.catalog.getSourceDefinition(input.kind)) {
            throw new Error(`Source kind is not available in the manifest catalog: ${input.kind}`);
        }
        sourceConfigSchema.parse(input.config);
    }
}
