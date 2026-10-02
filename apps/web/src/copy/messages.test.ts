import { describe, expect, it } from "vitest";

import baseline from "./inline-copy-baseline.json";
import { messages } from "./messages";
import { BANNED_UI_TERMS, scanInlineCopy } from "./scan";

/**
 * 集中文案模块的两条门禁（E6）：
 *
 * 1. **禁用词**：`ui-copy-review-v1` §D/§E 裁定的内部词不许出现在用户可见文案里。
 * 2. **内联文案只减不增**：还没迁进本模块的文件按条数登记在 `inline-copy-baseline.json`，
 *    新增内联文案、已登记文件增长、或已迁完却没从基线移除，都会失败。
 *    迁移进度：`bun run apps/web/src/copy/scan.ts`；重写基线：加 `--write-baseline`。
 */

/**
 * 已登记的禁用词例外，**只减不增**。每条都要写清归属与解除条件，
 * 否则例外会变成永久豁免。
 */
const BANNED_TERM_EXCEPTIONS = [
    {
        file: "components/cosmos/story-panel/story-actions.tsx",
        term: "Story ID",
        reason: "归并入口要用户粘贴内部编号（判据 R3）。改成可搜索的选择列表需要新增"
            + "「可作为归并目标的 Story 列表」只读查询，ui-copy-review-v1 §7 明确不把它"
            + "夹带进纯文案批次，留给界面职责重划的 Task。",
    },
] as const;

describe("集中文案模块", () => {
    it("按界面区域分册并向调用方暴露同一入口", () => {
        // 分册名就是界面区域名；改动这里等于改入口形状，应当是显式决定。
        expect(Object.keys(messages).toSorted()).toEqual([
            "automation",
            "common",
            "home",
            "library",
            "notices",
            "organize",
            "pages",
            "reading",
            "shell",
        ]);
    });

    it("用户可见文案里没有内部概念名", () => {
        const report = scanInlineCopy();
        const allowed = new Set(BANNED_TERM_EXCEPTIONS.map((item) => `${item.file}|${item.term}`));
        const unexpected = report.banned.filter((item) => !allowed.has(`${item.file}|${item.term}`));
        expect(
            unexpected.map((item) => `${item.file}:${item.line} 出现「${item.term}」— ${item.value}`),
        ).toEqual([]);

        // 例外本身也要对得上：修掉之后必须同步删掉登记，否则例外清单会腐烂。
        const observed = new Set(report.banned.map((item) => `${item.file}|${item.term}`));
        for (const exception of BANNED_TERM_EXCEPTIONS) {
            expect(
                observed.has(`${exception.file}|${exception.term}`),
                `例外已不存在，请从 BANNED_TERM_EXCEPTIONS 移除：${exception.file} / ${exception.term}`,
            ).toBe(true);
        }
    });

    it("内联文案只减不增", () => {
        const registered = baseline as Record<string, number>;
        const report = scanInlineCopy();
        const problems: string[] = [];

        for (const [file, hits] of report.files) {
            const limit = registered[file];
            if (limit === undefined) {
                problems.push(`新增内联文案：${file} 有 ${hits.length} 处，请迁进 apps/web/src/copy/`);
            } else if (hits.length > limit) {
                problems.push(`内联文案增长：${file} ${hits.length} 处 > 登记 ${limit} 处`);
            }
        }
        for (const [file, limit] of Object.entries(registered)) {
            const hits = report.files.get(file);
            if (hits === undefined) {
                problems.push(`已迁完却还在基线里：${file}（原 ${limit} 处），请从 inline-copy-baseline.json 移除`);
            } else if (hits.length < limit) {
                problems.push(`内联文案已减少：${file} ${hits.length} 处 < 登记 ${limit} 处，请下调登记值`);
            }
        }

        expect(problems).toEqual([]);
    });

    it("禁用词清单与术语表同源", () => {
        // 清单是判据的可执行形态，删除条目等于放宽门禁，应当是显式决定。
        expect([...BANNED_UI_TERMS]).toEqual([
            "分类",
            "历史壳",
            "未注册",
            "Spotlight",
            "Story ID",
            "受管理 subtype",
            "审计",
            "不变量",
            "provenance",
            "policy/version",
            "Revision",
        ]);
    });
});
