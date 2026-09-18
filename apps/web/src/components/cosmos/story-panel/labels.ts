import {
    PublicAssetSnapshot,
} from "@cosmos/contracts";

export const RELATION_TYPE_LABELS: Record<string, string> = {
    evidence_for: "证据",
    mentions: "提及",
};

export function relationTypeLabel(type: string): string {
    return RELATION_TYPE_LABELS[type] ?? type;
}

export function formatTimelineDate(value: string | null): string {
    if (!value) {
        return "时间未知";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "时间未知";
    }
    const pad = (part: number): string => part.toString().padStart(2, "0");
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}


export const KIND_LABELS: Record<string, string> = {
    image: "图片",
    audio: "音频",
    video: "视频",
    enclosure: "附件",
};

export const STORY_KIND_LABELS: Record<string, string> = {
    event: "事件",
    document: "文档",
    media: "媒体",
    thread: "讨论串",
};

export const STATUS_LABELS: Record<PublicAssetSnapshot["status"], string> = {
    saved: "已保存",
    metadata_only: "仅记录元数据",
    skipped: "未保存",
    failed: "保存失败",
};

export function formatBytes(value: number | null): string | null {
    if (value === null) {
        return null;
    }
    if (value >= 1024 * 1024) {
        return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${Math.max(1, Math.round(value / 1024))} KB`;
}

export function kindLabel(kind: string): string {
    return KIND_LABELS[kind] ?? kind;
}
