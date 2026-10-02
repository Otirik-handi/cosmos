"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { client } from "@/app/home/page-runtime";

import { createTopicCoalescer } from "./live-coalesce";

/**
 * 外壳级实时连接（ADR-0029 决策 7 / E2）。
 *
 * 只有一个 `EventSource`：`openEventStream` 每次调用都会新建一条连接，如果每个页面各自
 * 订阅，拆成十个页面就是十条连接。这里把连接与「什么数据变旧了」提升到外壳层，页面只
 * 订阅自己关心的 topic。
 *
 * topic 决定谁需要重读；未映射的事件类型只更新连接状态，不触发任何重读。同一 topic 在
 * `COALESCE_MS` 内的多条事件合并为一次通知，避免突发事件导致重读风暴（E7 预算）。
 */

export type StreamState = "connecting" | "connected" | "unavailable";

export type LiveTopic = "library" | "automation" | "stories";

const COALESCE_MS = 300;

/** 事件类型 → 需要重读的 topic。存储层实际发出的事件类型，Job 成功没有独立事件。 */
const TOPIC_BY_EVENT: Readonly<Record<string, LiveTopic>> = {
    "feed.updated.v1": "library",
    "run.queued.v1": "automation",
    "run.succeeded.v1": "automation",
    "run.failed.v1": "automation",
    "run.retry_wait.v1": "automation",
    "job.failed_terminal.v1": "automation",
    "story.revision_created.v1": "stories",
    "story.representation_projection_skipped.v1": "stories",
};

type LiveContextValue = {
    streamState: StreamState;
    subscribe: (topic: LiveTopic, handler: () => void) => () => void;
};

const LiveContext = createContext<LiveContextValue | null>(null);

export function LiveProvider({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const [streamState, setStreamState] = useState<StreamState>("connecting");
    const handlersRef = useRef(new Map<LiveTopic, Set<() => void>>());

    /**
     * 组件实验室（`/dev/**`）是开发期工具：它渲染固定 fixture、不连服务。在那里开连接
     * 只会拿到非 SSE 响应并在控制台报错，把实验室的「零控制台错误」验收弄脏。
     */
    const connect = !pathname.startsWith("/dev/");

    const subscribe = useCallback((topic: LiveTopic, handler: () => void) => {
        const handlers = handlersRef.current.get(topic) ?? new Set<() => void>();
        handlers.add(handler);
        handlersRef.current.set(topic, handlers);
        return () => {
            handlers.delete(handler);
        };
    }, []);

    const flush = useCallback((topic: LiveTopic) => {
        for (const handler of handlersRef.current.get(topic) ?? []) {
            handler();
        }
    }, []);

    useEffect(() => {
        if (!connect) {
            return;
        }
        const coalescer = createTopicCoalescer(COALESCE_MS, (topic) => flush(topic as LiveTopic));
        const closeEvents = client.openEventStream({
            onEvent: (event) => {
                setStreamState("connected");
                const topic = TOPIC_BY_EVENT[event.type];
                if (topic !== undefined) {
                    coalescer.notify(topic);
                }
            },
            onError: () => {
                setStreamState("unavailable");
            },
        });
        return () => {
            closeEvents();
            coalescer.dispose();
        };
    }, [connect, flush]);

    return (
        <LiveContext.Provider value={{ streamState, subscribe }}>
            {children}
        </LiveContext.Provider>
    );
}

function useLive(): LiveContextValue {
    const value = useContext(LiveContext);
    if (value === null) {
        throw new Error("LiveProvider is missing above this component.");
    }
    return value;
}

export function useStreamState(): StreamState {
    return useLive().streamState;
}

/** 页面订阅自己关心的 topic；回调通过 ref 转发，重渲染不会重建订阅。 */
export function useLiveTopic(topic: LiveTopic, handler: () => void): void {
    const { subscribe } = useLive();
    const handlerRef = useRef(handler);
    useEffect(() => {
        handlerRef.current = handler;
    }, [handler]);
    useEffect(() => {
        return subscribe(topic, () => handlerRef.current());
    }, [subscribe, topic]);
}
