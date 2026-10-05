import { TopicDetail } from "./topic-detail";

/**
 * 话题详情页（`/topics/:id`）：改标题与目的、改成员角色、移除与恢复成员。
 *
 * `params.id` 到这一层仍是 URL 编码形态（话题 id 含冒号，会被编码成 %3A），所以先解码
 * 一次再往下传：编码只由 transport 在拼请求路径时做，两处都做会变成 %253A 而 404
 * （与 Story 阅读页同一处理）。路由 id 只用于取数，**不进界面**（判据 R3）。
 */
export default async function TopicDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;

    return <TopicDetail topicId={decodeURIComponent(id)} />;
}
