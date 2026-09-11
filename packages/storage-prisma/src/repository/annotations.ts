import { type Annotation, type AnnotationList } from "@cosmos/contracts";
import { type TargetType } from "@cosmos/domain";
import { AnnotationNotFoundError } from "@cosmos/application";
import { appendDomainEvent } from "./repository-internals.js";
import { PrismaCosmosRepositoryCollections } from "./collections.js";

export class PrismaCosmosRepositoryAnnotations extends PrismaCosmosRepositoryCollections {
    async createAnnotation(input: {
        targetType: TargetType;
        targetId: string;
        body: string;
        quote?: string | null;
        evidence?: string | null;
        actor?: string | null;
    }): Promise<Annotation> {
        const targetId = await this.resolveTargetTargetId(input.targetType, input.targetId);
        // An annotation captures the target revision it was written against, so
        // a later target update does not silently re-point the note (ADR-0009
        // decision 4). Story targets use their current StoryRevision.
        const targetRevisionId = input.targetType === "story"
            ? (await this.prisma.story.findUnique({
                where: { id: targetId },
                select: { currentRevisionId: true },
            }))?.currentRevisionId ?? null
            : null;
        const annotation = await this.prisma.$transaction(async (tx) => {
            const created = await tx.annotation.create({
                data: {
                    targetType: input.targetType,
                    targetId,
                    targetRevisionId,
                    quote: input.quote?.trim() || null,
                    body: input.body,
                    evidence: input.evidence?.trim() || null,
                    actorJson: input.actor == null ? null : JSON.stringify(input.actor),
                },
            });
            await appendDomainEvent(tx, {
                type: "annotation.created.v1",
                aggregateType: "Annotation",
                aggregateId: created.id,
                payload: {
                    annotationId: created.id,
                    targetType: input.targetType,
                    targetId,
                    targetRevisionId,
                },
            });
            return created;
        });
        return this.toAnnotation(annotation);
    }

    async updateAnnotation(input: {
        annotationId: string;
        body: string;
        quote?: string | null;
        evidence?: string | null;
        actor?: string | null;
    }): Promise<Annotation | null> {
        const existing = await this.prisma.annotation.findUnique({
            where: { id: input.annotationId },
        });
        if (!existing) {
            throw new AnnotationNotFoundError(input.annotationId);
        }
        const annotation = await this.prisma.$transaction(async (tx) => {
            const updated = await tx.annotation.update({
                where: { id: input.annotationId },
                data: {
                    body: input.body,
                    quote: input.quote?.trim() || null,
                    evidence: input.evidence?.trim() || null,
                    actorJson: input.actor == null ? null : JSON.stringify(input.actor),
                },
            });
            await appendDomainEvent(tx, {
                type: "annotation.updated.v1",
                aggregateType: "Annotation",
                aggregateId: input.annotationId,
                payload: {
                    annotationId: input.annotationId,
                    targetType: existing.targetType,
                    targetId: existing.targetId,
                },
            });
            return updated;
        });
        return this.toAnnotation(annotation);
    }

    async deleteAnnotation(annotationId: string): Promise<void> {
        const existing = await this.prisma.annotation.findUnique({
            where: { id: annotationId },
            select: { id: true, targetType: true, targetId: true },
        });
        if (!existing) {
            throw new AnnotationNotFoundError(annotationId);
        }
        await this.prisma.$transaction(async (tx) => {
            await tx.annotation.delete({ where: { id: annotationId } });
            await appendDomainEvent(tx, {
                type: "annotation.deleted.v1",
                aggregateType: "Annotation",
                aggregateId: annotationId,
                payload: {
                    annotationId,
                    targetType: existing.targetType,
                    targetId: existing.targetId,
                },
            });
        });
    }

    async listAnnotations(input: {
        targetType: TargetType;
        targetId: string;
    }): Promise<AnnotationList> {
        const targetId = await this.resolveTargetTargetId(input.targetType, input.targetId);
        const rows = await this.prisma.annotation.findMany({
            where: { targetType: input.targetType, targetId },
            orderBy: { createdAt: "asc" },
        });
        return { items: rows.map((row) => this.toAnnotation(row)) };
    }

}
