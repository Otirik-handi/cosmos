/**
 * 事件合并窗口（E7 预算）：同一 topic 在 `coalesceMs` 内的多条事件只触发一次重读，
 * 防止突发事件造成重读风暴。
 *
 * 单独成模块的理由不只是可读：合并窗口是**可断言的预算**，把它从 React 组件里拿出来
 * 才能用假定时器逐毫秒验证（`live-coalesce.test.ts`），而不是靠浏览器里等真实事件。
 */
export type TopicCoalescer = {
    /** 记一次该 topic 的事件；窗口内重复调用只保留最后一次。 */
    notify: (topic: string) => void;
    /** 卸载时清掉所有待触发的定时器。 */
    dispose: () => void;
};

export function createTopicCoalescer(
    coalesceMs: number,
    onFlush: (topic: string) => void,
): TopicCoalescer {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    return {
        notify(topic) {
            const existing = timers.get(topic);
            if (existing !== undefined) {
                clearTimeout(existing);
            }
            timers.set(topic, setTimeout(() => {
                timers.delete(topic);
                onFlush(topic);
            }, coalesceMs));
        },
        dispose() {
            for (const timer of timers.values()) {
                clearTimeout(timer);
            }
            timers.clear();
        },
    };
}
