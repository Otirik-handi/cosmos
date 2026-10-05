import { EntityDetailView } from "./entity-detail";

/**
 * Entity 详情页（`/entities/:id`）。列表页的每一行都链到这里。
 *
 * `params.id` 到这一层仍是 URL 编码形态（entity id 含冒号，会被编码成 %3A），所以先解码
 * 一次再往下传：编码只由 transport 在拼请求路径时做，两处都做会变成 %253A 而 404。
 * `key` 让换一个 Entity 时重新挂载，免得旧对象的名称与新对象的读取状态混在一屏。
 */
export default async function EntityDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    const entityId = decodeURIComponent(id);

    return <EntityDetailView entityId={entityId} key={entityId} />;
}
