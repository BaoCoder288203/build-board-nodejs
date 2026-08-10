-- AlterEnum
CREATE TYPE "MeetingTileBgMode" AS ENUM ('NONE', 'BLUR', 'IMAGE');

-- AlterTable
ALTER TABLE "meeting_participants"
  ADD COLUMN "display_name" VARCHAR(80),
  ADD COLUMN "tile_bg_mode" "MeetingTileBgMode" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "tile_bg_url" TEXT;
