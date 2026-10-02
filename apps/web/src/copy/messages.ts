import { automation } from "./areas/automation";
import { common } from "./areas/common";
import { home } from "./areas/home";
import { library } from "./areas/library";
import { notices } from "./areas/notices";
import { organize } from "./areas/organize";
import { pages } from "./areas/pages";
import { reading } from "./areas/reading";
import { shell } from "./areas/shell";

/**
 * 集中文案模块（E6）：界面文案全部从这里取，`@/copy/messages` 是唯一入口。
 *
 * 为什么不写成一个大对象：991 处文案塞进一个文件会直接越过代码规模治理的
 * 30 KB 警戒线，因此按界面区域分册（`./areas/*`），本文件只做拼装。
 *
 * 为什么用常量对象而不是 i18n 框架：不引入依赖、不包 provider、读代码能看到原文，
 * 术语表只有一个落点，禁用词扫描与「新文案必须走 messages」都能写成测试
 * （见 `messages.test.ts`）。将来真要加第二语言，从这里迁到 next-intl 的机械工作量
 * 与现在直接上框架相当，不构成技术债。
 *
 * 尚未迁完的部分按文件登记在 `inline-copy-baseline.json`（只减不增），
 * 迁移进度用 `bun run --cwd apps/web vitest src/copy` 查看。
 */
export const messages = {
    common,
    shell,
    home,
    library,
    pages,
    organize,
    automation,
    reading,
    notices,
} as const;
