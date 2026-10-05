import { StoryReading } from "./story-reading";

/**
 * Story 阅读页（ADR-0029 决策 7）。`(reading)` 组是工作区里唯一的例外路由：只有顶栏
 * 与返回入口，没有侧栏——读一条内容时宽度优先。正文与各区块在 StoryReading 里取数。
 *
 * 限宽由 `StoryReading` 自己承担（两栏 3:1 的整组宽度 = 视口 80%），这一层不再包一层
 * max-width：曾经这里限宽 640px，两栏版面落地后会把它压成放不下右栏的窄条。
 *
 * `params.id` 到这一层仍是 URL 编码形态（story id 含冒号，会被编码成 %3A），所以先解码
 * 一次再往下传：编码只由 transport 在拼请求路径时做，两处都做会变成 %253A 而 404。
 */
export default async function StoryPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;

    return <StoryReading storyId={decodeURIComponent(id)} />;
}
