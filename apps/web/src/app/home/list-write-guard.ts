import {
    useCallback,
    useRef,
} from "react";

/**
 * 用户可变列表的写入版本。**纯逻辑，不依赖 React**，所以规则本身可以在 node 层被测。
 *
 * 这类列表有两条写入路径：周期刷新（`refresh`）与用户动作（建标签、建收藏夹、存视图…）。
 * 刷新抓快照可能**比用户动作更早发起、却更晚落地**，于是把刚写下的新值覆盖回旧值——
 * 实测过一次：创建标签后 32ms，一个更早发起、被慢请求拖住的刷新周期用空列表覆盖了它，
 * 标签从界面消失，也就没法再挂到别的 Story。
 *
 * 判定轴与 Feed 的 `searchGeneration` 不同：那边怕的是"搜索条件已变"，这边怕的是
 * "用户改过"。规则有三条：
 * 1. 本地写入后，**在此之前发起**的刷新快照一律丢弃；
 * 2. 没有本地写入时，刷新照常写入；
 * 3. 刷新之间不互相作废——刷新不推进版本，否则连续两次刷新里后一次会永远写不进去。
 *
 * **只给"两条路径都写"的列表用。** 只有一个写入者的列表不能加守卫：例如来源列表只由
 * 刷新写，加了守卫会让新建的来源永远刷不出来。
 */
export function createWriteVersion() {
    let version = 0;
    return {
        /** 刷新发起前取版本，落地时回传比对。 */
        current: (): number => version,
        /** 本地写入：推进版本，使在此之前发起的刷新快照失效。 */
        markLocalWrite: (): void => {
            version += 1;
        },
        /** 刷新落地：期间发生过本地写入就返回 false（调用方据此丢弃快照）。 */
        acceptsRefresh: (captured: number): boolean => captured === version,
    };
}

export type WriteVersion = ReturnType<typeof createWriteVersion>;

/** 把写入版本绑到 React 状态上；规则本身见 `createWriteVersion`。 */
export function useGuardedList<T>(apply: (next: T) => void) {
    const guard = useRef(createWriteVersion());
    return {
        version: useCallback((): number => guard.current.current(), []),
        writeLocal: useCallback(
            (next: T): void => {
                guard.current.markLocalWrite();
                apply(next);
            },
            [apply],
        ),
        writeFromRefresh: useCallback(
            (next: T, captured: number): void => {
                if (guard.current.acceptsRefresh(captured)) {
                    apply(next);
                }
            },
            [apply],
        ),
    };
}
