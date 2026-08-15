-- CreateEnum
CREATE TYPE "UnoRoomStatus" AS ENUM ('WAITING', 'READY', 'PLAYING', 'FINISHED', 'CLOSED');

-- CreateEnum
CREATE TYPE "UnoGameStatus" AS ENUM ('INITIALIZING', 'DEALING', 'PLAYING', 'WAITING_FOR_COLOR', 'WAITING_FOR_CHALLENGE', 'PAUSED', 'ROUND_FINISHED', 'FINISHED', 'ABORTED');

-- CreateEnum
CREATE TYPE "UnoContextType" AS ENUM ('MEETING', 'BOARD', 'WORKSPACE');

-- CreateTable
CREATE TABLE "uno_rooms" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "board_id" UUID,
    "meeting_id" UUID,
    "context_type" "UnoContextType" NOT NULL,
    "host_user_id" UUID NOT NULL,
    "status" "UnoRoomStatus" NOT NULL DEFAULT 'WAITING',
    "max_players" INTEGER NOT NULL DEFAULT 6,
    "allow_spectator" BOOLEAN NOT NULL DEFAULT true,
    "rules" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uno_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uno_players" (
    "id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "display_name" VARCHAR(255) NOT NULL,
    "is_host" BOOLEAN NOT NULL DEFAULT false,
    "is_spectator" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(32) NOT NULL,
    "connection_status" VARCHAR(32) NOT NULL,
    "seat_index" INTEGER,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uno_players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uno_game_sessions" (
    "id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "status" "UnoGameStatus" NOT NULL,
    "round_number" INTEGER NOT NULL DEFAULT 1,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "scores" JSONB NOT NULL,
    "rules" JSONB NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "winner_id" UUID,
    "end_reason" VARCHAR(64),

    CONSTRAINT "uno_game_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uno_game_results" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "scores" JSONB NOT NULL,
    "winner_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uno_game_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "uno_rooms_workspace_id_status_idx" ON "uno_rooms"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "uno_rooms_meeting_id_idx" ON "uno_rooms"("meeting_id");

-- CreateIndex
CREATE INDEX "uno_rooms_board_id_idx" ON "uno_rooms"("board_id");

-- CreateIndex
CREATE INDEX "uno_players_room_id_idx" ON "uno_players"("room_id");

-- CreateIndex
CREATE INDEX "uno_players_user_id_idx" ON "uno_players"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uno_players_room_id_user_id_key" ON "uno_players"("room_id", "user_id");

-- CreateIndex
CREATE INDEX "uno_game_sessions_room_id_started_at_idx" ON "uno_game_sessions"("room_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "uno_game_results_session_id_key" ON "uno_game_results"("session_id");

-- AddForeignKey
ALTER TABLE "uno_rooms" ADD CONSTRAINT "uno_rooms_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uno_rooms" ADD CONSTRAINT "uno_rooms_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uno_rooms" ADD CONSTRAINT "uno_rooms_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uno_rooms" ADD CONSTRAINT "uno_rooms_host_user_id_fkey" FOREIGN KEY ("host_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uno_players" ADD CONSTRAINT "uno_players_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "uno_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uno_players" ADD CONSTRAINT "uno_players_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uno_game_sessions" ADD CONSTRAINT "uno_game_sessions_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "uno_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uno_game_results" ADD CONSTRAINT "uno_game_results_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "uno_game_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
