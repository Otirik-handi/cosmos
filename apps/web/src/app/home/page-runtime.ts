import {
    CosmosTransportError,
    HttpCosmosClient,
} from "@cosmos/transport-http";

import type { SourceFormValues } from "@/components/cosmos/source-form";
import type { RelatedStoryPorts } from "@/lib/related-stories";

/**
 * 页面级运行时:客户端单例、来源定义常量与无状态 helper。
 * 从 `page.tsx` 拆出(G06 切片 4),只做搬运,不改行为。
 */

export const client = new HttpCosmosClient({
    baseUrl: process.env.NEXT_PUBLIC_COSMOS_API_URL ?? "",
});

/**
 * 相关内容 v1 的读取端口：只组合已有读合同（search/entity/story），
 * 不引入新的服务端接口，也不参与 Story 的权威关系。
 */
export const RELATED_STORY_PORTS: RelatedStoryPorts = {
    searchByLabelIds: async (labelIds) => {
        return (await client.search({labelIds, limit: 10})).items;
    },
    entity: (entityId) => client.entity(entityId),
    story: (storyId) => client.story(storyId),
};

/** 产品入口默认选中这个来源定义；表单字段仍由所选 manifest 的 schema 驱动。 */
export const RSS_SOURCE_DEFINITION_REF = "source.rss@1";
export const RSS_OPERATION_ID = "fetch";
export const PROBE_POLL_INTERVAL_MS = 1_500;
export const PROBE_POLL_TIMEOUT_MS = 30_000;

/**
 * 表单里的定时以“分钟”输入，保存为 canonical 合同的 scheduleIntervalMs
 * （ADR-0018：定时是 TriggerBinding，不再写进 config）；清空表示关闭定时。
 */
export function toScheduleIntervalMs(values: SourceFormValues): number | undefined {
    return values.scheduleIntervalMinutes !== ""
        ? Number(values.scheduleIntervalMinutes) * 60_000
        : undefined;
}

export function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

export function readError(error: unknown): string {
    if (error instanceof CosmosTransportError) {
        return `服务请求失败（HTTP ${error.status}）。`;
    }
    return error instanceof Error ? error.message : "发生未知错误。";
}

export function toBoundaryIso(
    value: string | undefined,
    endOfDay: boolean,
): string | undefined {
    if (!value) {
        return undefined;
    }
    const suffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
    return new Date(`${value}${suffix}`).toISOString();
}

/** 视图条件存的是 canonical ISO 时间；日期输入框只接受 YYYY-MM-DD 前缀。 */
export function toDateInputValue(value: string | null): string {
    if (!value) {
        return "";
    }
    const match = /^(\d{4}-\d{2}-\d{2})/u.exec(value);
    return match ? match[1] : "";
}
