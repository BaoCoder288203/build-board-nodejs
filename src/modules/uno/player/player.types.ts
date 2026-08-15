import type { ConnectionStatus, PlayerStatus } from "../shared/uno.enums.js";

export type UnoPlayerRecord = {
  id: string;
  roomId: string;
  userId: string;
  displayName: string;
  isHost: boolean;
  isSpectator: boolean;
  status: PlayerStatus;
  connectionStatus: ConnectionStatus;
  seatIndex: number | null;
};
