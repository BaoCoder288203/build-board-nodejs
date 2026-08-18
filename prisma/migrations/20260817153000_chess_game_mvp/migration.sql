-- CreateEnum
CREATE TYPE "ChessRoomStatus" AS ENUM ('WAITING', 'READY', 'PLAYING', 'FINISHED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ChessGameStatus" AS ENUM ('INITIALIZING', 'PLAYING', 'WAITING_FOR_PROMOTION', 'WAITING_FOR_DRAW', 'PAUSED', 'FINISHED', 'ABORTED');

-- CreateEnum
CREATE TYPE "ChessContextType" AS ENUM ('MEETING', 'BOARD', 'WORKSPACE');

-- CreateTable
CREATE TABLE "chess_rooms" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "board_id" UUID,
    "meeting_id" UUID,
    "context_type" "ChessContextType" NOT NULL,
    "host_user_id" UUID NOT NULL,
    "status" "ChessRoomStatus" NOT NULL DEFAULT 'WAITING',
    "max_players" INTEGER NOT NULL DEFAULT 2,
    "allow_spectator" BOOLEAN NOT NULL DEFAULT true,
    "initial_time_ms" INTEGER NOT NULL DEFAULT 600000,
    "increment_ms" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chess_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chess_players" (
    "id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "display_name" VARCHAR(255) NOT NULL,
    "is_host" BOOLEAN NOT NULL DEFAULT false,
    "is_spectator" BOOLEAN NOT NULL DEFAULT false,
    "color" VARCHAR(8),
    "status" VARCHAR(32) NOT NULL,
    "connection_status" VARCHAR(32) NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chess_players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chess_game_sessions" (
    "id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "status" "ChessGameStatus" NOT NULL,
    "fen" TEXT NOT NULL,
    "pgn" TEXT NOT NULL,
    "moves" JSONB NOT NULL DEFAULT '[]',
    "white_time_ms" INTEGER NOT NULL,
    "black_time_ms" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "winner_id" UUID,
    "end_reason" VARCHAR(64),
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "chess_game_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chess_game_results" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "pgn" TEXT NOT NULL,
    "fen" TEXT NOT NULL,
    "winner_id" UUID,
    "reason" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chess_game_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chess_rooms_workspace_id_status_idx" ON "chess_rooms"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "chess_rooms_meeting_id_idx" ON "chess_rooms"("meeting_id");

-- CreateIndex
CREATE INDEX "chess_rooms_board_id_idx" ON "chess_rooms"("board_id");

-- CreateIndex
CREATE INDEX "chess_players_room_id_idx" ON "chess_players"("room_id");

-- CreateIndex
CREATE INDEX "chess_players_user_id_idx" ON "chess_players"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "chess_players_room_id_user_id_key" ON "chess_players"("room_id", "user_id");

-- CreateIndex
CREATE INDEX "chess_game_sessions_room_id_started_at_idx" ON "chess_game_sessions"("room_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "chess_game_results_session_id_key" ON "chess_game_results"("session_id");

-- AddForeignKey
ALTER TABLE "chess_rooms" ADD CONSTRAINT "chess_rooms_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chess_rooms" ADD CONSTRAINT "chess_rooms_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chess_rooms" ADD CONSTRAINT "chess_rooms_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chess_rooms" ADD CONSTRAINT "chess_rooms_host_user_id_fkey" FOREIGN KEY ("host_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chess_players" ADD CONSTRAINT "chess_players_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "chess_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chess_players" ADD CONSTRAINT "chess_players_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chess_game_sessions" ADD CONSTRAINT "chess_game_sessions_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "chess_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chess_game_results" ADD CONSTRAINT "chess_game_results_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chess_game_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
