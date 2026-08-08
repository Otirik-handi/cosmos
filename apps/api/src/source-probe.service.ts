import { Inject, Injectable } from "@nestjs/common";

import {
    ConnectorRegistry,
} from "@cosmos/application";
import {
    type CreateSourceCommand,
    type ConnectorDescriptor,
    type SourceSnapshot,
    sourceConfigSchema,
} from "@cosmos/contracts";

@Injectable()
export class SourceProbeService {
    constructor(
        @Inject(ConnectorRegistry)
        private readonly connectors: ConnectorRegistry,
    ) {}

    list(): readonly ConnectorDescriptor[] {
        return this.connectors.descriptors();
    }

    validate(input: CreateSourceCommand): void {
        const now = new Date().toISOString();
        this.connectors.validate({
            id: "pending",
            name: input.name,
            kind: input.kind,
            config: sourceConfigSchema.parse(input.config),
            enabled: input.enabled ?? true,
            createdAt: now,
            updatedAt: now,
            lastRunAt: null,
            lastError: null,
        });
    }

}
