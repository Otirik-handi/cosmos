import { contentRepresentationSchema } from "@cosmos/contracts";
import type { ContentRepresentationContract } from "@cosmos/contracts";
import type { EvidenceStatus } from "@cosmos/domain";
import { requireContentProfile, type ContentReadAuthority } from "./content-access-policy.js";
import { adaptLegacyContentText } from "./content-normalizer.js";

export interface ContentReadTarget {
    entryRevisionId: string;
    representationVersion?: number;
}

export interface ContentReadSource {
    entryId: string;
    entryRevisionId: string;
    contentText: string;
    currentRepresentationId: string | null;
    representation: unknown;
    evidenceStatus: EvidenceStatus;
}

export interface ContentQueryRepository {
    readContentSource(target: ContentReadTarget): Promise<ContentReadSource | null>;
}

export interface StructuredContentView {
    entryId: string;
    entryRevisionId: string;
    representation: ContentRepresentationContract | null;
    contentText: string;
    readingMode: "representation" | "legacy-text" | "unavailable";
    evidenceStatus: EvidenceStatus;
}

export class ContentQuery {
    constructor(private readonly repository: ContentQueryRepository) {}

    async structuredContent(target: ContentReadTarget, authority: ContentReadAuthority): Promise<StructuredContentView | null> {
        requireContentProfile(authority, "structured-content");
        if (target.representationVersion !== undefined && (!Number.isSafeInteger(target.representationVersion) || target.representationVersion < 1)) {
            throw new Error("Invalid content representation version");
        }
        const source = await this.repository.readContentSource(target);
        if (!source) return null;
        if (source.entryRevisionId !== target.entryRevisionId) {
            throw new Error("Content source revision mismatch");
        }
        const parsed = contentRepresentationSchema.safeParse(source.representation);
        const representation = parsed.success ? parsed.data : null;
        if (representation && representation.entryRevisionId !== target.entryRevisionId) {
            throw new Error("Content representation belongs to another source revision");
        }
        if (representation && target.representationVersion !== undefined && representation.representationVersion !== target.representationVersion) {
            throw new Error("Content representation version mismatch");
        }
        if (representation && target.representationVersion === undefined && representation.id !== source.currentRepresentationId) {
            throw new Error("Content representation current pointer mismatch");
        }
        // An explicit historical reference must never turn into current or legacy content.
        const legacy = !representation && target.representationVersion === undefined && source.currentRepresentationId === null;
        return {
            entryId: source.entryId,
            entryRevisionId: source.entryRevisionId,
            representation,
            contentText: representation?.contentText ?? (legacy ? adaptLegacyContentText(source.contentText).contentText : ""),
            readingMode: representation ? "representation" : legacy ? "legacy-text" : "unavailable",
            evidenceStatus: !representation && !legacy ? "representation-unavailable" : source.evidenceStatus,
        };
    }
}
