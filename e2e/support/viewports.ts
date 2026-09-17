/**
 * 移动端适配后置（维护者 2026-09-17 裁定 PC 优先，移动端等 PC 端做好后再适配）：
 * 390px 的页面级横向溢出检查当前**不执行**，PC/平板宽度照常验证。
 *
 * 恢复条件：把 `MOBILE_WIDTH_VERIFIED` 置回 true，并**先**给溢出断言补失败现场打印
 * （最宽的溢出元素 + viewport/clientWidth/scrollWidth）——该断言此前在 CI 反复间歇
 * 失败（见 docs/testing/known-unstable-cases.md 第 2、3 条），失败信息只有两个数字，
 * 无法判断是真实布局溢出还是测量时序。
 */
export const MOBILE_WIDTH_VERIFIED = false;

/** 移动端宽度：产品当前不做适配，这里只登记，不参与验证。 */
export const DEFERRED_MOBILE_WIDTH = 390;

/** 按开关过滤候选宽度：暂停期间剔除移动端宽度，PC/平板原样保留。 */
export function verifiedWidths(candidates: readonly number[]): number[] {
    return MOBILE_WIDTH_VERIFIED
        ? [...candidates]
        : candidates.filter((width) => width !== DEFERRED_MOBILE_WIDTH);
}
