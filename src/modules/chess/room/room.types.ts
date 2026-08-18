import type {
  ChessColor,
  ConnectionStatus,
  PlayerStatus,
  RoomStatus,
  ChessContextType,
} from "../shared/chess.enums.js";

export type PublicChessPlayer = {
  playerId: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  isHost: boolean;
  isSpectator: boolean;
  isReady: boolean;
  color: ChessColor | null;
  status: PlayerStatus;
  connectionStatus: ConnectionStatus;
  joinedAt: string;
};

export type PublicChessRoom = {
  id: string;
  status: RoomStatus;
  hostId: string;
  hostUserId: string;
  contextType: ChessContextType;
  meetingId: string | null;
  boardId: string | null;
  workspaceId: string;
  maxPlayers: number;
  allowSpectator: boolean;
  initialTimeMs: number;
  incrementMs: number;
  players: PublicChessPlayer[];
  gameId: string | null;
  createdAt: string;
};
