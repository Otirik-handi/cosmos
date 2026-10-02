import { afterEach, describe, expect, it, vi } from "vitest";

import { createTopicCoalescer } from "./live-coalesce";

const WINDOW_MS = 300;

afterEach(() => {
    vi.useRealTimers();
});

describe("事件合并窗口（E7）", () => {
    it("同一 topic 在窗口内的多条事件只触发一次重读", () => {
        vi.useFakeTimers();
        const flushed: string[] = [];
        const coalescer = createTopicCoalescer(WINDOW_MS, (topic) => flushed.push(topic));

        coalescer.notify("library");
        vi.advanceTimersByTime(100);
        coalescer.notify("library");
        vi.advanceTimersByTime(100);
        coalescer.notify("library");

        // 三次事件都还在窗口内：一次都不该触发。
        expect(flushed).toEqual([]);
        vi.advanceTimersByTime(WINDOW_MS);
        expect(flushed).toEqual(["library"]);
    });

    it("不同 topic 各自计时，互不推迟", () => {
        vi.useFakeTimers();
        const flushed: string[] = [];
        const coalescer = createTopicCoalescer(WINDOW_MS, (topic) => flushed.push(topic));

        coalescer.notify("library");
        vi.advanceTimersByTime(150);
        coalescer.notify("automation");

        // library 先到期：后到的 automation 不该把它的窗口往后推。
        vi.advanceTimersByTime(150);
        expect(flushed).toEqual(["library"]);
        vi.advanceTimersByTime(150);
        expect(flushed).toEqual(["library", "automation"]);
    });

    it("窗口过去之后的事件重新开一次通知", () => {
        vi.useFakeTimers();
        const flushed: string[] = [];
        const coalescer = createTopicCoalescer(WINDOW_MS, (topic) => flushed.push(topic));

        coalescer.notify("stories");
        vi.advanceTimersByTime(WINDOW_MS);
        coalescer.notify("stories");
        vi.advanceTimersByTime(WINDOW_MS);

        expect(flushed).toEqual(["stories", "stories"]);
    });

    it("卸载后不再触发待发的通知", () => {
        vi.useFakeTimers();
        const flushed: string[] = [];
        const coalescer = createTopicCoalescer(WINDOW_MS, (topic) => flushed.push(topic));

        coalescer.notify("library");
        coalescer.notify("automation");
        coalescer.dispose();
        vi.advanceTimersByTime(WINDOW_MS * 4);

        expect(flushed).toEqual([]);
    });
});
