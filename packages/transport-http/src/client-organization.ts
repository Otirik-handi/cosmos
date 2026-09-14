import {
    labelListSchema,
    labelDetailSchema,
    labelItemSchema,
    collectionListSchema,
    collectionDetailSchema,
    collectionSummarySchema,
    favoriteListSchema,
    annotationSchema,
    annotationListSchema,
    createAnnotationCommandSchema,
    updateAnnotationCommandSchema,
    savedViewSchema,
    savedViewListSchema,
    createSavedViewCommandSchema,
    updateSavedViewCommandSchema,
    userOrganizationAckSchema,
    createLabelCommandSchema,
    labelAssignmentCommandSchema,
    createCollectionCommandSchema,
    updateCollectionCommandSchema,
    collectionItemCommandSchema,
    favoriteCommandSchema,
    type LabelList,
    type LabelDetail,
    type LabelItem,
    type CollectionList,
    type CollectionDetail,
    type CollectionSummary,
    type FavoriteList,
    type Annotation,
    type AnnotationList,
    type CreateAnnotationCommand,
    type UpdateAnnotationCommand,
    type SavedView,
    type SavedViewList,
    type CreateSavedViewCommand,
    type UpdateSavedViewCommand,
    type UserOrganizationAck,
    type CreateLabelCommand,
    type LabelAssignmentCommand,
    type CreateCollectionCommand,
    type UpdateCollectionCommand,
    type CollectionItemCommand,
    type FavoriteCommand,
} from "@cosmos/contracts";

import { ContentClient } from "./client-content.js";
import type {
    CosmosEventSource,
    HttpCosmosClientOptions,
} from "./types.js";
import { CosmosTransportError } from "./types.js";
export class OrganizationClient extends ContentClient {
    async listLabels(): Promise<LabelList> {
        return this.request("/api/v1/labels", {
            schema: labelListSchema,
        });
    }

    async label(labelId: string): Promise<LabelDetail> {
        return this.request(`/api/v1/labels/${encodeURIComponent(labelId)}`, {
            schema: labelDetailSchema,
        });
    }

    async createLabel(input: CreateLabelCommand): Promise<LabelItem> {
        const payload = createLabelCommandSchema.parse(input);
        return this.request("/api/v1/labels", {
            method: "POST",
            body: payload,
            schema: labelItemSchema,
        });
    }

    async deleteLabel(labelId: string): Promise<UserOrganizationAck> {
        return this.request(`/api/v1/labels/${encodeURIComponent(labelId)}/removals`, {
            method: "POST",
            schema: userOrganizationAckSchema,
        });
    }

    async attachLabel(input: LabelAssignmentCommand): Promise<UserOrganizationAck> {
        const payload = labelAssignmentCommandSchema.parse(input);
        return this.request("/api/v1/label-assignments", {
            method: "POST",
            body: payload,
            schema: userOrganizationAckSchema,
        });
    }

    async detachLabel(input: LabelAssignmentCommand): Promise<UserOrganizationAck> {
        const payload = labelAssignmentCommandSchema.parse(input);
        return this.request("/api/v1/label-assignments/removals", {
            method: "POST",
            body: payload,
            schema: userOrganizationAckSchema,
        });
    }

    async listCollections(options: { storyId?: string } = {}): Promise<CollectionList> {
        const params = new URLSearchParams();
        if (options.storyId) {
            params.set("storyId", options.storyId);
        }
        const query = params.toString();
        return this.request(`/api/v1/collections${query ? `?${query}` : ""}`, {
            schema: collectionListSchema,
        });
    }

    async collection(collectionId: string): Promise<CollectionDetail> {
        return this.request(`/api/v1/collections/${encodeURIComponent(collectionId)}`, {
            schema: collectionDetailSchema,
        });
    }

    async createCollection(input: CreateCollectionCommand): Promise<CollectionSummary> {
        const payload = createCollectionCommandSchema.parse(input);
        return this.request("/api/v1/collections", {
            method: "POST",
            body: payload,
            schema: collectionSummarySchema,
        });
    }

    async updateCollection(
        collectionId: string,
        input: UpdateCollectionCommand,
    ): Promise<CollectionSummary> {
        const payload = updateCollectionCommandSchema.parse(input);
        return this.request(`/api/v1/collections/${encodeURIComponent(collectionId)}`, {
            method: "PATCH",
            body: payload,
            schema: collectionSummarySchema,
        });
    }

    async deleteCollection(collectionId: string): Promise<UserOrganizationAck> {
        return this.request(`/api/v1/collections/${encodeURIComponent(collectionId)}/removals`, {
            method: "POST",
            schema: userOrganizationAckSchema,
        });
    }

    async addCollectionItem(
        collectionId: string,
        input: CollectionItemCommand,
    ): Promise<UserOrganizationAck> {
        const payload = collectionItemCommandSchema.parse(input);
        return this.request(`/api/v1/collections/${encodeURIComponent(collectionId)}/items`, {
            method: "POST",
            body: payload,
            schema: userOrganizationAckSchema,
        });
    }

    async removeCollectionItem(
        collectionId: string,
        input: CollectionItemCommand,
    ): Promise<UserOrganizationAck> {
        const payload = collectionItemCommandSchema.parse(input);
        return this.request(
            `/api/v1/collections/${encodeURIComponent(collectionId)}/items/removals`,
            {
                method: "POST",
                body: payload,
                schema: userOrganizationAckSchema,
            },
        );
    }

    async listFavorites(): Promise<FavoriteList> {
        return this.request("/api/v1/favorites", {
            schema: favoriteListSchema,
        });
    }

    async setFavorite(input: FavoriteCommand): Promise<UserOrganizationAck> {
        const payload = favoriteCommandSchema.parse(input);
        return this.request("/api/v1/favorites", {
            method: "POST",
            body: payload,
            schema: userOrganizationAckSchema,
        });
    }

    async unsetFavorite(input: FavoriteCommand): Promise<UserOrganizationAck> {
        const payload = favoriteCommandSchema.parse(input);
        return this.request("/api/v1/favorites/removals", {
            method: "POST",
            body: payload,
            schema: userOrganizationAckSchema,
        });
    }

    async listAnnotations(input: {
        targetType: string;
        targetId: string;
    }): Promise<AnnotationList> {
        const params = new URLSearchParams({
            targetType: input.targetType,
            targetId: input.targetId,
        });
        return this.request(`/api/v1/annotations?${params.toString()}`, {
            schema: annotationListSchema,
        });
    }

    async createAnnotation(input: CreateAnnotationCommand): Promise<Annotation> {
        const payload = createAnnotationCommandSchema.parse(input);
        return this.request("/api/v1/annotations", {
            method: "POST",
            body: payload,
            schema: annotationSchema,
        });
    }

    async updateAnnotation(
        annotationId: string,
        input: UpdateAnnotationCommand,
    ): Promise<Annotation> {
        const payload = updateAnnotationCommandSchema.parse(input);
        return this.request(`/api/v1/annotations/${encodeURIComponent(annotationId)}`, {
            method: "PATCH",
            body: payload,
            schema: annotationSchema,
        });
    }

    async deleteAnnotation(annotationId: string): Promise<UserOrganizationAck> {
        return this.request(
            `/api/v1/annotations/${encodeURIComponent(annotationId)}/removals`,
            {
                method: "POST",
                schema: userOrganizationAckSchema,
            },
        );
    }

    async listSavedViews(): Promise<SavedViewList> {
        return this.request("/api/v1/saved-views", {
            schema: savedViewListSchema,
        });
    }

    async createSavedView(input: CreateSavedViewCommand): Promise<SavedView> {
        const payload = createSavedViewCommandSchema.parse(input);
        return this.request("/api/v1/saved-views", {
            method: "POST",
            body: payload,
            schema: savedViewSchema,
        });
    }

    async updateSavedView(
        savedViewId: string,
        input: UpdateSavedViewCommand,
    ): Promise<SavedView> {
        const payload = updateSavedViewCommandSchema.parse(input);
        return this.request(`/api/v1/saved-views/${encodeURIComponent(savedViewId)}`, {
            method: "PATCH",
            body: payload,
            schema: savedViewSchema,
        });
    }

    async deleteSavedView(savedViewId: string): Promise<UserOrganizationAck> {
        return this.request(
            `/api/v1/saved-views/${encodeURIComponent(savedViewId)}/removals`,
            {
                method: "POST",
                schema: userOrganizationAckSchema,
            },
        );
    }
}
