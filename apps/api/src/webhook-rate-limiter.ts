/**
 * 单入口速率限制（ADR-0024）。它是进程内存里的滑动窗口，不是 durable truth：API 重启后
 * 窗口清零——限流只保护进程与来源平台，不承担配额或计费语义，所以不需要持久化。
 */
export class WebhookEntryRateLimiter {
    private readonly hits = new Map<string, number[]>();

    constructor(
        private readonly maxRequests: number,
        private readonly windowMs: number,
        /**
         * 桶数上限。入口请求是未认证的，任何人都能用任意 token 造一个新桶，所以桶数不能
         * 无界增长；满了就淘汰最久没动过的桶（Map 的插入顺序配合每次命中后重插实现）。
         */
        private readonly maxKeys = 512,
    ) {}

    /** 记一次请求；返回 false 表示这个窗口内已经超过上限。 */
    take(key: string, now: number): boolean {
        const recent = (this.hits.get(key) ?? []).filter((at) => now - at < this.windowMs);
        if (recent.length >= this.maxRequests) {
            this.hits.delete(key);
            this.hits.set(key, recent);
            return false;
        }
        if (!this.hits.has(key) && this.hits.size >= this.maxKeys) {
            const oldest = this.hits.keys().next().value;
            if (oldest !== undefined) this.hits.delete(oldest);
        }
        recent.push(now);
        this.hits.delete(key);
        this.hits.set(key, recent);
        return true;
    }
}
