import type {
  ConnectionStatus,
  PlayerStatus,
  RoomStatus,
  UnoRoomContextType,
} from "../shared/uno.enums.js";
import type { GameRules } from "../game/game.state.js";

export type PublicUnoPlayer = {
  playerId: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  isHost: boolean;
  isSpectator: boolean;
  isReady: boolean;
  status: PlayerStatus;
  connectionStatus: ConnectionStatus;
  seatIndex: number | null;
  joinedAt: string;
};

export type PublicUnoRoom = {
  id: string;
  status: RoomStatus;
  hostId: string;
  hostUserId: string;
  contextType: UnoRoomContextType;
  meetingId: string | null;
  boardId: string | null;
  workspaceId: string;
  maxPlayers: number;
  allowSpectator: boolean;
  rules: GameRules;
  players: PublicUnoPlayer[];
  gameId: string | null;
  createdAt: string;
};
