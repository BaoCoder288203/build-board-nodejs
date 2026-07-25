-- Ensure archive flags exist on drifted databases (e.g. Neon created before schema included these columns).
-- Safe to re-run: IF NOT EXISTS.

ALTER TABLE "boards"
  ADD COLUMN IF NOT EXISTS "is_archived" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "boards_is_archived_idx"
  ON "boards"("is_archived");

ALTER TABLE "columns"
  ADD COLUMN IF NOT EXISTS "is_archived" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "columns_is_archived_idx"
  ON "columns"("is_archived");
