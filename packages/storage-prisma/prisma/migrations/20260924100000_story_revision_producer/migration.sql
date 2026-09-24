-- 人工真相的判据（Proposal user-truth-protection-v1 决定 1，ADR-0028）。
-- 之前 StoryRevision 没有写入者字段，`actorJson` 又是自由文本显示字段（Web 的人工
-- 编辑根本不传它），所以「这条 Revision 是人写的还是 ingest 投影写的」在数据上不可
-- 判定，任何保护实现都只能猜。
--
-- 回填信号：`story.revision_created.v1` 只由命令路径发出（updateStoryRevision 与
-- splitStory 的后继 Revision），ingest 的 Entry→Story 投影不发这个事件。所以
-- 「有匹配事件 = 人工」是可靠的一次性判据，不需要启发式猜测。
--
-- 事件被裁剪过的库匹配不到，保持默认 `system`——保守方向是「不声称人工」，代价是
-- 那些历史编辑要重新编辑一次才受保护；反向误判（把自动行当人工）会让所有既有 Story
-- 停止跟随来源，代价更大。
ALTER TABLE "StoryRevision" ADD COLUMN "producer" TEXT NOT NULL DEFAULT 'system';

UPDATE "StoryRevision"
SET "producer" = 'human'
WHERE EXISTS (
    SELECT 1 FROM "DomainEvent" e
    WHERE e."type" = 'story.revision_created.v1'
      AND json_extract(e."payloadJson", '$.storyId') = "StoryRevision"."storyId"
      AND json_extract(e."payloadJson", '$.revision') = "StoryRevision"."revision"
);
