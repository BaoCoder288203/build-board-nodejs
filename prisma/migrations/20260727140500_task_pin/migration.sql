-- Ensure pinned flag exists on tasks for collaboration UX.
-- Safe for drifted databases.

ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "is_pinned" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "tasks_column_id_is_pinned_idx"
  ON "tasks"("column_id", "is_pinned");
