/** 页面内各域 hook 的共享上下文：页面壳持有的通知与加载态 setter。 */

export type Notify = (message: string | null) => void;

export type WorkspaceContext = {
    setError: Notify;
    setNotice: Notify;
    setLoading: (value: boolean) => void;
};
