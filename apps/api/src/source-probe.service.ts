import { Injectable } from "@nestjs/common";

import {
    type IngestConnector,
} from "@cosmos/application";
import {
    type SourceSnapshot,
    type SourceTestResult,
} from "@cosmos/contracts";
import {
    createFixtureRssConnector,
    createRssConnector,
} from "@cosmos/plugin-rss";

@Injectable()
export class SourceProbeService {
    async test(source: SourceSnapshot): Promise<SourceTestResult> {
        const connector = this.resolveConnector(source);
        const result = await connector.fetchItems({
            source,
            cursor: null,
        });
        return {
            sourceId: source.id,
            connectorId: connector.id,
            itemCount: result.items.length,
            nextCursor: result.nextCursor,
            checkedAt: new Date().toISOString(),
        };
    }

    private resolveConnector(source: SourceSnapshot): IngestConnector {
        if (source.kind === "rss") {
            return createRssConnector();
        }
        return createFixtureRssConnector({
            rootDirectory: process.env.COSMOS_WORKSPACE_ROOT ?? process.cwd(),
        });
    }
}
