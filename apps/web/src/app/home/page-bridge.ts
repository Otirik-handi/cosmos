/** 页面内各域 hook 的共享上下文：页面壳持有的通知与加载态 setter。 */

export type Notify = (message: string | null) => void;

/** 回执的语气。默认 `success`（绝大多数 `setNotice` 是写成功回执），纯信息才传 `info`。 */
export type NoticeVariant = "success" | "info";

/**
 * 回执入口。`variant` 是**参数**而不是 context 上的可变字段：React Compiler 的
 * `react-hooks/immutability` 会拦住「改上下文对象上的属性」，而且参数让语气在调用点一眼可见。
 */
export type SetNotice = (message: string | null, variant?: NoticeVariant) => void;

export type WorkspaceContext = {
    setError: Notify;
    /**
     * 写入或操作的回执。**怎么呈现由页面决定**：所有页面都渲染成 toast
     * （`useNoticeToast`），阅读页与内容组共用同一个 Provider。
     */
    setNotice: SetNotice;
    setLoading: (value: boolean) => void;
};
