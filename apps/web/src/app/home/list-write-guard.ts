import {
    useCallback,
    useMemo,
    useRef,
} from "react";

/**
 * 列表状态的写入闸门。**纯逻辑，不依赖 React**，所以规则本身可以在 node 层被测。
 *
 * 一个列表可能有多个异步读取者（首屏加载、周期刷新、动作后的重读），读取者之间
 * 没有顺序保证：先发起的读取可能后落地，把新值覆盖回旧值。实测过两次：
 * ① 创建标签后 32ms，一个更早发起、被慢请求拖住的刷新周期用空列表覆盖了它；
 * ② 创建实体后，首屏那次读取落地，把刚建的实体从侧栏抹掉，此后不再出现。
 *
 * 判定轴有两条，缺一不可：
 * 1. **读取序号**：落地时若已有更晚发起的读取，这份快照就是旧的，丢弃；
 * 2. **本地写入版本**：读取发起之后用户改过这个列表，这份快照同样是旧的，丢弃。
 *
 * 规则刻意不做的两件事：
 * - 刷新之间不互相作废：读取不推进版本，否则连续两次读取里后一次会永远写不进去；
 * - 只有一个写入者的列表不必加本地写入守卫，但要加读取序号守卫。
 */
export function createWriteVersion() {
    let version = 0;
    let latestReadTicket = 0;
    return {
        /** 读取发起前取票，落地时回传比对。 */
        beginRead: (): ReadTicket => {
            latestReadTicket += 1;
            return { ticket: latestReadTicket, version };
        },
        /** 本地写入：推进版本，使在此之前发起的读取快照失效。 */
        markLocalWrite: (): void => {
            version += 1;
        },
        /** 读取落地：不是最新一次读取、或期间发生过本地写入，就返回 false。 */
        acceptsRead: (read: ReadTicket): boolean =>
            read.ticket === latestReadTicket && read.version === version,
    };
}

/** 一次读取的票据：发起时的读取序号与本地写入版本。 */
export type ReadTicket = {
    readonly ticket: number;
    readonly version: number;
};

export type WriteVersion = ReturnType<typeof createWriteVersion>;

/** 把写入闸门绑到 React 状态上；规则本身见 `createWriteVersion`。 */
export function useGuardedList<T>(apply: (next: T) => void) {
    const guard = useRef(createWriteVersion());
    const beginRead = useCallback((): ReadTicket => guard.current.beginRead(), []);
    const writeLocal = useCallback(
        (next: T): void => {
            guard.current.markLocalWrite();
            apply(next);
        },
        [apply],
    );
    const writeFromRead = useCallback(
        (next: T, read: ReadTicket): void => {
            if (guard.current.acceptsRead(read)) {
                apply(next);
            }
        },
        [apply],
    );
    // 身份稳定：调用方会把返回对象放进 effect／callback 依赖，每次渲染新建会让它们重跑。
    return useMemo(
        () => ({ beginRead, writeLocal, writeFromRead }),
        [beginRead, writeLocal, writeFromRead],
    );
}
