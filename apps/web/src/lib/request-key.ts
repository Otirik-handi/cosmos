/**
 * 写请求的幂等键：同一次用户动作重试时要复用同一个键，用户重新发起时才换新键。
 *
 * 所以这里只提供「造一个键」，不提供「记住上次的键」——记住会让两次本来不同的意图
 * 合并成一次写入，用户改了内容再点保存却什么都没变。键在提交那一刻生成，重试沿用
 * 组件里的同一个字符串。
 */
export function newRequestKey(): string {
    return globalThis.crypto.randomUUID();
}
