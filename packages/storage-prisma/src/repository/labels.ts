import { type LabelItem, type LabelList } from "@cosmos/contracts";
import { type TargetType } from "@cosmos/domain";
import { LabelConflictError, LabelNotFoundError } from "@cosmos/application";
import { appendDomainEvent, isUniqueConstraintError } from "./repository-internals.js";
import { PrismaCosmosRepositoryEntryRelations } from "./entry-relations.js";

export class PrismaCosmosRepositoryLabels extends PrismaCosmosRepositoryEntryRelations {
    async createLabel(input: { name: string }): Promise<LabelItem> {
        const name = input.name.trim();
        const label = await this.prisma.$transaction(async (tx) => {
            try {
                const created = await tx.label.create({ data: { name } });
                await appendDomainEvent(tx, {
                    type: "label.created.v1",
                    aggregateType: "Label",
                    aggregateId: created.id,
                    payload: { labelId: created.id, name },
                });
                return created;
            } catch (error) {
                if (isUniqueConstraintError(error)) {
                    throw new LabelConflictError(`Label already exists: ${name}`);
                }
                throw error;
            }
        });
        return {
            id: label.id,
            name: label.name,
            assignedCount: 0,
            createdAt: label.createdAt.toISOString(),
            updatedAt: label.updatedAt.toISOString(),
        };
    }

    /**
     * 标签改名（Task 36 切片 E）。Label 是可变行而不是 revision 模型，所以这是原地改写；
     * `name` 有唯一约束，撞名沿用 createLabel 的同一档错误（LabelConflictError → 409），
     * 不另造一种「改名专用冲突」。
     */
    async updateLabel(input: { labelId: string; name: string }): Promise<LabelItem> {
        const existing = await this.prisma.label.findUnique({
            where: { id: input.labelId },
            select: { id: true },
        });
        if (!existing) {
            throw new LabelNotFoundError(input.labelId);
        }
        const name = input.name.trim();
        await this.prisma.$transaction(async (tx) => {
            try {
                await tx.label.update({
                    where: { id: input.labelId },
                    data: { name },
                });
            } catch (error) {
                if (isUniqueConstraintError(error)) {
                    throw new LabelConflictError(`Label already exists: ${name}`);
                }
                throw error;
            }
            await appendDomainEvent(tx, {
                type: "label.updated.v1",
                aggregateType: "Label",
                aggregateId: input.labelId,
                payload: { labelId: input.labelId, name },
            });
        });
        const updated = await this.prisma.label.findUnique({
            where: { id: input.labelId },
            include: { _count: { select: { assignments: true } } },
        });
        if (!updated) {
            throw new LabelNotFoundError(input.labelId);
        }
        return {
            id: updated.id,
            name: updated.name,
            assignedCount: updated._count.assignments,
            createdAt: updated.createdAt.toISOString(),
            updatedAt: updated.updatedAt.toISOString(),
        };
    }

    async listLabels(): Promise<LabelList> {
        const rows = await this.prisma.label.findMany({
            orderBy: { name: "asc" },
            include: {
                _count: { select: { assignments: true } },
            },
        });
        return {
            items: rows.map((label) => ({
                id: label.id,
                name: label.name,
                assignedCount: label._count.assignments,
                createdAt: label.createdAt.toISOString(),
                updatedAt: label.updatedAt.toISOString(),
            })),
        };
    }

    async deleteLabel(labelId: string): Promise<void> {
        const label = await this.prisma.label.findUnique({
            where: { id: labelId },
            select: { id: true },
        });
        if (!label) {
            throw new LabelNotFoundError(labelId);
        }
        await this.prisma.$transaction(async (tx) => {
            await tx.label.delete({ where: { id: labelId } });
            await appendDomainEvent(tx, {
                type: "label.deleted.v1",
                aggregateType: "Label",
                aggregateId: labelId,
                payload: { labelId },
            });
        });
    }

    async attachLabel(input: {
        labelId: string;
        targetType: TargetType;
        targetId: string;
    }): Promise<void> {
        const label = await this.prisma.label.findUnique({
            where: { id: input.labelId },
            select: { id: true },
        });
        if (!label) {
            throw new LabelNotFoundError(input.labelId);
        }
        const targetId = await this.resolveTargetTargetId(input.targetType, input.targetId);
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.labelAssignment.findUnique({
                where: {
                    labelId_targetType_targetId: {
                        labelId: input.labelId,
                        targetType: input.targetType,
                        targetId,
                    },
                },
                select: { id: true },
            });
            if (existing) {
                return;
            }
            await tx.labelAssignment.create({
                data: {
                    labelId: input.labelId,
                    targetType: input.targetType,
                    targetId,
                },
            });
            await appendDomainEvent(tx, {
                type: "label.assigned.v1",
                aggregateType: "Label",
                aggregateId: input.labelId,
                payload: {
                    labelId: input.labelId,
                    targetType: input.targetType,
                    targetId,
                },
            });
        });
    }

    async detachLabel(input: {
        labelId: string;
        targetType: TargetType;
        targetId: string;
    }): Promise<void> {
        const label = await this.prisma.label.findUnique({
            where: { id: input.labelId },
            select: { id: true },
        });
        if (!label) {
            throw new LabelNotFoundError(input.labelId);
        }
        const targetId = await this.resolveTargetTargetId(input.targetType, input.targetId);
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.labelAssignment.findUnique({
                where: {
                    labelId_targetType_targetId: {
                        labelId: input.labelId,
                        targetType: input.targetType,
                        targetId,
                    },
                },
                select: { id: true },
            });
            if (!existing) {
                return;
            }
            await tx.labelAssignment.delete({ where: { id: existing.id } });
            await appendDomainEvent(tx, {
                type: "label.unassigned.v1",
                aggregateType: "Label",
                aggregateId: input.labelId,
                payload: {
                    labelId: input.labelId,
                    targetType: input.targetType,
                    targetId,
                },
            });
        });
    }

}
