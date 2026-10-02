/**
 * 页面级错误与回执横幅。
 *
 * 写入口径的回执与读取失败必须让用户看见：同一段标记此前在首页、阅读页、信息库、话题、
 * Entity 五个页面里各抄了一遍，改一处样式要改五处（`/automation` 的回执多一个对勾图标，
 * 是它自己的变体，没有并进来）。
 * 两段都用 `role`：`alert` 会被读屏立即打断，`status` 是礼貌播报——错误与回执的分工。
 */
export function PageBanners({
    error,
    notice,
}: {
    error?: string | null;
    notice?: string | null;
}) {
    return (
        <>
            {error && (
                <div
                    className="rounded-[var(--radius-control)] border border-destructive/30 bg-destructive/10 p-3 text-[13px] leading-6 text-destructive"
                    role="alert"
                >
                    {error}
                </div>
            )}
            {notice && (
                <div
                    className="rounded-[var(--radius-control)] border border-border bg-muted/40 p-3 text-[13px] leading-6"
                    role="status"
                >
                    {notice}
                </div>
            )}
        </>
    );
}
