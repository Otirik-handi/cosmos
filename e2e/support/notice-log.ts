import { expect, type Page } from "@playwright/test";

type NoticeRecord = { t: number; text: string };

declare global {
    interface Window {
        __noticeLog?: NoticeRecord[];
    }
}

/**
 * 在页面内记录 `role="status"` 提示语的每次变化。
 *
 * 提示语是单槽位、会被后来的消息替换：实测坏来源的「录入任务已排队」只存在
 * 480–554ms，而且失败提示可能先于它出现。对这类亚秒级状态做轮询断言，结果取决于
 * "某一次轮询有没有落在窗口里"，慢轮里就会落空。记录器把"出现过"变成页面内的确定事实，
 * 断言的含义不变（仍然要求那段文字真的渲染过）。
 *
 * 必须在 `page.goto` 之前调用：它靠 init script 在文档创建时挂上观察者。
 */
export async function installNoticeRecorder(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const log: NoticeRecord[] = [];
        window.__noticeLog = log;
        const read = (): string => Array.from(document.querySelectorAll('[role="status"]'))
            .map((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim())
            .filter((text) => text.length > 0)
            .join(" || ");
        const record = (): void => {
            const text = read();
            const last = log[log.length - 1];
            if (!last || last.text !== text) {
                log.push({ t: Math.round(performance.now()), text });
            }
        };
        // init script 在 documentElement 出现之前就跑，所以观察 document 本身。
        new MutationObserver(record).observe(document, {
            subtree: true,
            childList: true,
            characterData: true,
        });
        window.setInterval(record, 20);
    });
}

/** 清空记录：只关心"这一步之后"出现过什么提示。 */
export async function resetNoticeLog(page: Page): Promise<void> {
    await page.evaluate(() => {
        window.__noticeLog?.splice(0, window.__noticeLog.length);
    });
}

/** 断言某段提示语在页面内出现过（允许它已经被后来的提示替换）。 */
export async function expectNoticeAppeared(page: Page, fragment: string, timeout = 15_000): Promise<void> {
    await expect.poll(
        () => page.evaluate(
            (needle) => (window.__noticeLog ?? []).some((record) => record.text.includes(needle)),
            fragment,
        ),
        { timeout },
    ).toBe(true);
}
