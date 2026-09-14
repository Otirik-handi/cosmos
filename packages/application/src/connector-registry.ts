/** Connector 注册表。 */

import type {
    ConnectorDescriptor, SourceSnapshot,
} from "@cosmos/contracts";

import type {
    IngestConnector,
} from "./connector-ports.js";

export class ConnectorRegistry {
    private readonly connectors = new Map<string, IngestConnector>();

    constructor(connectors: readonly IngestConnector[] = []) {
        for (const connector of connectors) {
            this.register(connector);
        }
    }

    register(connector: IngestConnector): this {
        if (this.connectors.has(connector.id)) {
            throw new Error(`Duplicate connector id: ${connector.id}`);
        }
        this.connectors.set(connector.id, connector);
        return this;
    }

    resolve(source: SourceSnapshot): IngestConnector {
        const connector = this.connectors.get(source.connectorId);
        if (!connector) {
            throw new Error(`Unsupported source connector: ${source.connectorId}`);
        }
        return connector;
    }

    validate(source: SourceSnapshot): IngestConnector {
        const connector = this.resolve(source);
        connector.validate(source);
        return connector;
    }

    descriptors(): readonly ConnectorDescriptor[] {
        return [...this.connectors.values()].map((connector) => ({
            id: connector.id,
            description: connector.description,
            capabilities: [...connector.capabilities],
            configVersion: connector.configVersion,
        }));
    }
}
