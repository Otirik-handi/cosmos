import type { Prisma } from "@prisma/client";
import { contentRepresentationSchema, type InputProjection, type SourceStatus } from "@cosmos/contracts";
import { storedRepresentation } from "./content-query.js";

/** Only included references affect freshness; unavailable evidence wins over supersession. */
export async function deepReadSourceStatus(tx: Prisma.TransactionClient, input: InputProjection): Promise<SourceStatus> {
    let status: SourceStatus = "current";
    for (const source of input.sources.filter((item) => !item.omitted)) {
        const version = source.representationVersion;
        if (version === null || !Number.isSafeInteger(version) || version <= 0 || source.blockIds.length === 0) return "unavailable";
        const revision = await tx.entryRevision.findUnique({
            where: { id: source.entryRevisionId },
            select: { entryId: true, currentRepresentationId: true, evidenceObservationId: true, entry: { select: { currentRevisionId: true } } },
        });
        const row = await tx.contentRepresentation.findUnique({
            where: { entryRevisionId_representationVersion: { entryRevisionId: source.entryRevisionId, representationVersion: version } },
        });
        let parsed;
        try { parsed = contentRepresentationSchema.safeParse(storedRepresentation(row)); }
        catch { return "unavailable"; }
        if (!revision?.evidenceObservationId || revision.entryId !== source.entryId || !parsed.success || parsed.data.status === "failed") return "unavailable";
        if (revision.entry.currentRevisionId !== source.entryRevisionId || revision.currentRepresentationId !== parsed.data.id) status = "superseded";
    }
    return status;
}
