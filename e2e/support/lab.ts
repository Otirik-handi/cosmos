import { expect, type Locator, type Page } from "@playwright/test";

/**
 * 组件实验室的预览台。
 *
 * `LabStage` 在开发模式下会瞬时渲染两份（会话同步 / URL 归一化的那一帧），此时
 * `page.locator(PREVIEW_ROOT)` 会命中 2 个节点，Playwright 的严格模式直接判失败——
 * 实测 `source-form` 与 `story-edit-panel` 各假红过一次，单跑都能通过。
 *
 * 稳定态确实只有一份，所以这里既容忍瞬时态、又把「只有一个预览台」当成不变量断言。
 */
export const PREVIEW_ROOT = "[data-component-lab-preview]";

export async function expectSinglePreview(page: Page): Promise<Locator> {
    const preview = page.locator(PREVIEW_ROOT);
    await expect(preview).toHaveCount(1);
    await expect(preview).toBeVisible();
    return preview;
}

/**
 * 回执 toast 的作用域。
 *
 * 写回执自 2026-10-03 起走 toast（`ToastProvider` + `ToastHost`），不再是页面顶部的
 * `[role="status"]` 横幅。**同一个页面可以同时挂着多条 toast**（每条 5 秒），
 * 所以按文案直接 `page.getByText(...)` 会撞上严格模式（实测搜索回执连续出现两次即假红）。
 */
export function toastScope(page: Page): Locator {
    return page.locator('[data-slot="toast-viewport"]');
}

/**
 * **最新一条**回执 toast。
 *
 * 不能按 DOM 顺序取最后一条：队列里可能同时存在同文案的旧回执，实测 `.last()` 命中旧的那条
 * （`source-lifecycle-and-search-filters.spec.ts` 因此假红）。宿主给每条回执挂了自增序号
 * `data-toast-seq`，这里按序号最大值取——「最新」由序号定义，不靠顺序猜。
 */
export async function latestToast(page: Page): Promise<Locator> {
    const roots = toastScope(page).locator('[data-slot="toast-root"]');
    await expect(roots.first()).toBeVisible();
    const sequence = await roots.evaluateAll((nodes) => {
        return Math.max(...nodes.map((node) => Number(node.getAttribute("data-toast-seq") ?? "0")));
    });
    return page.locator(`[data-slot="toast-root"][data-toast-seq="${sequence}"]`);
}
