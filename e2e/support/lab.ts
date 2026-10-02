import { expect, type Locator, type Page } from "@playwright/test";

/**
 * 组件实验室的预览台。
 *
 * `LabStage` 在开发模式下会瞬时渲染两份（会话同步 / URL 归一化的那一帧），此时
 * `page.locator(PREVIEW_ROOT)` 会命中 2 个节点，Playwright 的严格模式直接判失败——
 * 实测 `source-form` 与 `story-edit-surface` 各假红过一次，单跑都能通过。
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
