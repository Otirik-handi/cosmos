-- Activation replays must return the recorded first result even after later
-- PATCHes move the source forward; the snapshot column freezes that response.
ALTER TABLE "SourceActivationCommand" ADD COLUMN "resultSnapshotJson" TEXT;
