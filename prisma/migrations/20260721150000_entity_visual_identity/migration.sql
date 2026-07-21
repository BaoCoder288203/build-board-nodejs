-- Workspace theme gradient
ALTER TABLE "workspaces"
  ADD COLUMN "theme_color_from" VARCHAR(7),
  ADD COLUMN "theme_color_to" VARCHAR(7);

-- Project theme gradient (copied from workspace) + initial letter in icon
ALTER TABLE "projects"
  ADD COLUMN "theme_color_from" VARCHAR(7),
  ADD COLUMN "theme_color_to" VARCHAR(7);

-- Board nature cover image URL
ALTER TABLE "boards"
  ADD COLUMN "cover_url" TEXT;
