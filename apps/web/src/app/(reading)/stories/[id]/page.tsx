import { StoryReading } from "./story-reading";

/**
 * Story 阅读页（ADR-0029 决策 7）。`(reading)` 组是工作区里唯一的例外路由：只有顶栏
 * 与返回入口，没有侧栏——读一条内容时宽度优先。正文与各区块在 StoryReading 里取数。
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

    return (
        <div className="flex w-full justify-center">
            <div className="w-full max-w-[640px]">
                <StoryReading storyId={decodeURIComponent(id)} />
            </div>
        </div>
    );
}
