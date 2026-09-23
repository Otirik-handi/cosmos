import { describe, expect, it } from "vitest";

import { WebhookEntryRateLimiter } from "./webhook-rate-limiter.js";

describe("WebhookEntryRateLimiter", () => {
    it("在窗口内按上限放行，超过就拒绝", () => {
        const limiter = new WebhookEntryRateLimiter(2, 60_000);
        expect(limiter.take("tok", 1_000)).toBe(true);
        expect(limiter.take("tok", 1_001)).toBe(true);
        expect(limiter.take("tok", 1_002)).toBe(false);
    });

    it("窗口滑出后重新放行，且不同入口各自计数", () => {
        const limiter = new WebhookEntryRateLimiter(1, 60_000);
        expect(limiter.take("a", 1_000)).toBe(true);
        expect(limiter.take("a", 1_500)).toBe(false);
        // 同一时刻另一个入口有自己的桶。
        expect(limiter.take("b", 1_500)).toBe(true);
        expect(limiter.take("a", 61_000)).toBe(true);
    });

    it("桶数有上限：未认证请求用任意 token 造桶也不会无界增长", () => {
        const limiter = new WebhookEntryRateLimiter(1, 60_000, 2);
        expect(limiter.take("a", 1_000)).toBe(true);
        expect(limiter.take("b", 1_001)).toBe(true);
        expect(limiter.take("c", 1_002)).toBe(true);
        // a 是最久没动的桶，被淘汰后重新计数；没有淘汰时这里会是 false。
        expect(limiter.take("a", 1_003)).toBe(true);
    });
});
