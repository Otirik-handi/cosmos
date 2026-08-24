import { Inject, Injectable } from "@nestjs/common";

import type { CatalogPort } from "@cosmos/application/catalog";
import {
    getSourceConfigurationSchema,
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

    validate(input: Pick<CreateSourceCommand, "sourceDefinitionRef" | "operationId" | "config">): void {
        const manifest = this.catalog.getSourceDefinitionByRef(input.sourceDefinitionRef);
        if (!manifest || manifest.status !== "enabled" || !manifest.operationIds.includes(input.operationId)) {
            throw new Error(`Source definition is not available: ${input.sourceDefinitionRef}`);
        }
        // The canonical Zod schema owns validation semantics; the manifest's
        // JSON Schema stays a published projection and cannot express
        // connector-specific conditionals on its own.
        const configurationSchema = getSourceConfigurationSchema(input.sourceDefinitionRef);
        if (!configurationSchema) {
            throw new Error(`No canonical configuration schema is registered for ${input.sourceDefinitionRef}.`);
        }
        configurationSchema.parse(input.config);
    }
}
