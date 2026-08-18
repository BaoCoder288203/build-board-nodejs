import { Chess, type Color, type Move, type Square } from "chess.js";
import {
  afterMove,
  createClocks,
  remainingMs,
  stopClocks,
  timedOutColor,
  type ChessClocks,
} from "./clock.js";
import {
  CHESS_GAME_STATUS,
  CHESS_MVP,
  END_REASON,
  ENGINE_ACTION,
  type ChessColor,
  type ChessEndReason,
  type ChessEngineActionType,
  type ChessGameStatus,
  type ChessPromotion,
} from "../shared/chess.enums.js";
import { CHESS_ERROR, type ChessErrorCode } from "../shared/chess.errors.js";

const PROMOTIONS = new Set<ChessPromotion>(["q", "r", "b", "n"]);
const SQUARE_RE = /^[a-h][1-8]$/;

export type ChessSeat = {
  playerId: string;
  userId: string;
};

export type ChessStoredMove = {
  from: string;
  to: string;
  san: string;
  promotion?: ChessPromotion;
  captured?: string;
  color: ChessColor;
  fen: string;
};

export type ChessLastMove = {
  from: string;
  to: string;
  san: string;
  promotion?: ChessPromotion;
  captured?: string;
};

export type ChessRuntimeState = {
  gameId: string;
  roomId: string;
  status: ChessGameStatus;
  fen: string;
  pgn: string;
  sequence: number;
  turn: ChessColor;
  inCheck: boolean;
  whitePlayerId: string;
  blackPlayerId: string;
  whiteUserId: string;
  blackUserId: string;
  clocks: ChessClocks;
  drawOfferBy: string | null;
  lastMove: ChessLastMove | null;
  moves: ChessStoredMove[];
  winnerId: string | null;
  winnerColor: ChessColor | null;
  endReason: ChessEndReason | null;
};

export type ChessDomainEvent =
  | { type: "GAME_STARTED"; payload: Record<string, unknown> }
  | { type: "MOVED"; payload: Record<string, unknown> }
  | { type: "DRAW_OFFERED"; payload: Record<string, unknown> }
  | { type: "DRAW_RESOLVED"; payload: Record<string, unknown> }
  | { type: "CLOCK_SYNC"; payload: Record<string, unknown> }
  | { type: "GAME_ENDED"; payload: Record<string, unknown> };

export type ChessEngineCommand = {
  gameId?: string;
  playerId?: string;
  requestId: string;
  type: ChessEngineActionType;
  now?: number;
  payload?: Record<string, unknown>;
};

export type ChessActionOk = {
  ok: true;
  sequence: number;
  state: ChessRuntimeState;
  events: ChessDomainEvent[];
  alreadyProcessed?: boolean;
};

export type ChessActionFail = {
  ok: false;
  code: ChessErrorCode;
  sequence?: number;
};

export type ChessActionResult = ChessActionOk | ChessActionFail;

function colorFromTurn(turn: Color): ChessColor {
  return turn === "w" ? "WHITE" : "BLACK";
}

function asJsColor(color: ChessColor): Color {
  return color === "WHITE" ? "w" : "b";
}

function opposite(color: ChessColor): ChessColor {
  return color === "WHITE" ? "BLACK" : "WHITE";
}

export function opponentHasInsufficientMaterial(chess: Chess, opponent: ChessColor): boolean {
  const color = asJsColor(opponent);
  const minors: Array<"n" | "b"> = [];
  let heavyOrPawn = 0;
  for (const row of chess.board()) {
    for (const square of row) {
      if (!square || square.color !== color || square.type === "k") continue;
      if (square.type === "q" || square.type === "r" || square.type === "p") {
        heavyOrPawn += 1;
      } else if (square.type === "n" || square.type === "b") {
        minors.push(square.type);
      }
    }
  }
  if (heavyOrPawn > 0) return false;
  if (minors.length === 0) return true;
  if (minors.length === 1) return true;
  return false;
}

export function evaluateEndReason(chess: Chess): ChessEndReason | null {
  if (chess.isCheckmate()) return END_REASON.CHECKMATE;
  if (chess.isStalemate()) return END_REASON.STALEMATE;
  if (chess.isInsufficientMaterial()) return END_REASON.INSUFFICIENT_MATERIAL;
  if (chess.isThreefoldRepetition()) return END_REASON.THREEFOLD;
  if (chess.isDrawByFiftyMoves() || chess.isDraw()) return END_REASON.FIFTY_MOVE;
  return null;
}

function isPromotion(value: unknown): value is ChessPromotion {
  return typeof value === "string" && PROMOTIONS.has(value as ChessPromotion);
}

export class ChessEngine {
  readonly chess: Chess;
  state: ChessRuntimeState;
  private readonly processed = new Map<string, ChessActionResult>();

  constructor(state: ChessRuntimeState, chess?: Chess) {
    this.state = state;
    this.chess = chess ?? new Chess(state.fen);
  }

  static start(input: {
    gameId: string;
    roomId: string;
    white: ChessSeat;
    black: ChessSeat;
    requestId: string;
    now?: number;
    initialTimeMs?: number;
  }): ChessStartResult {
    const now = input.now ?? Date.now();
    const chess = new Chess();
    const engine = new ChessEngine(
      {
        gameId: input.gameId,
        roomId: input.roomId,
        status: CHESS_GAME_STATUS.PLAYING,
        fen: chess.fen(),
        pgn: chess.pgn(),
        sequence: 1,
        turn: "WHITE",
        inCheck: chess.inCheck(),
        whitePlayerId: input.white.playerId,
        blackPlayerId: input.black.playerId,
        whiteUserId: input.white.userId,
        blackUserId: input.black.userId,
        clocks: createClocks(now, input.initialTimeMs ?? CHESS_MVP.initialTimeMs),
        drawOfferBy: null,
        lastMove: null,
        moves: [],
        winnerId: null,
        winnerColor: null,
        endReason: null,
      },
      chess,
    );
    const result: ChessActionOk = {
      ok: true,
      sequence: engine.state.sequence,
      state: engine.state,
      events: [
        {
          type: "GAME_STARTED",
          payload: engine.startedPayload(now),
        },
        {
          type: "CLOCK_SYNC",
          payload: engine.clockPayload(now),
        },
      ],
    };
    engine.processed.set(input.requestId, result);
    return { ...result, engine };
  }

  apply(command: ChessEngineCommand): ChessActionResult {
    const cached = this.processed.get(command.requestId);
    if (cached) {
      return cached.ok ? { ...cached, alreadyProcessed: true } : cached;
    }
    const now = command.now ?? Date.now();

    if (command.gameId && command.gameId !== this.state.gameId) {
      return { ok: false, code: CHESS_ERROR.GAME_NOT_FOUND };
    }

    let result: ChessActionResult;
    switch (command.type) {
      case ENGINE_ACTION.MOVE:
        result = this.move(command, now);
        break;
      case ENGINE_ACTION.RESIGN:
        result = this.resign(command, now);
        break;
      case ENGINE_ACTION.OFFER_DRAW:
        result = this.offerDraw(command, now);
        break;
      case ENGINE_ACTION.RESPOND_DRAW:
        result = this.respondDraw(command, now);
        break;
      case ENGINE_ACTION.TIMEOUT:
        result = this.timeout(now);
        break;
      case ENGINE_ACTION.PLAYER_LEFT:
        result = this.playerLeft(command, now);
        break;
      case ENGINE_ACTION.ABORT:
        result = this.abort(command, now);
        break;
      default:
        result = { ok: false, code: CHESS_ERROR.GAME_NOT_PLAYING };
    }

    if (result.ok) this.processed.set(command.requestId, result);
    return result;
  }

  playerColor(playerId: string): ChessColor | null {
    if (playerId === this.state.whitePlayerId) return "WHITE";
    if (playerId === this.state.blackPlayerId) return "BLACK";
    return null;
  }

  playerIdFor(color: ChessColor): string {
    return color === "WHITE" ? this.state.whitePlayerId : this.state.blackPlayerId;
  }

  syncClocks(now = Date.now()) {
    return this.clockPayload(now);
  }

  checkTimeout(now = Date.now()): ChessActionResult | null {
    if (!this.isLive()) return null;
    const flagged = timedOutColor(this.state.clocks, now);
    if (!flagged) return null;
    return this.timeout(now);
  }

  private isLive() {
    return (
      this.state.status === CHESS_GAME_STATUS.PLAYING ||
      this.state.status === CHESS_GAME_STATUS.WAITING_FOR_PROMOTION ||
      this.state.status === CHESS_GAME_STATUS.WAITING_FOR_DRAW
    );
  }

  private requireLivePlayer(playerId?: string): ChessActionFail | ChessColor {
    if (!this.isLive()) {
      return {
        ok: false,
        code:
          this.state.status === CHESS_GAME_STATUS.FINISHED
            ? CHESS_ERROR.GAME_ALREADY_FINISHED
            : CHESS_ERROR.GAME_NOT_PLAYING,
        sequence: this.state.sequence,
      };
    }
    if (!playerId) return { ok: false, code: CHESS_ERROR.NOT_ROOM_MEMBER };
    const color = this.playerColor(playerId);
    if (!color) return { ok: false, code: CHESS_ERROR.SPECTATOR_ACTION_DENIED };
    return color;
  }

  private move(command: ChessEngineCommand, now: number): ChessActionResult {
    const colorOrErr = this.requireLivePlayer(command.playerId);
    if (typeof colorOrErr !== "string") return colorOrErr;
    const color = colorOrErr;

    const timeout = this.checkTimeout(now);
    if (timeout) return timeout;

    if (this.state.turn !== color) {
      return { ok: false, code: CHESS_ERROR.NOT_YOUR_TURN, sequence: this.state.sequence };
    }

    const payload = command.payload ?? {};
    const from = typeof payload.from === "string" ? payload.from : "";
    const to = typeof payload.to === "string" ? payload.to : "";
    const promotionRaw = payload.promotion;

    if (!SQUARE_RE.test(from) || !SQUARE_RE.test(to)) {
      return { ok: false, code: CHESS_ERROR.ILLEGAL_MOVE, sequence: this.state.sequence };
    }
    if (promotionRaw !== undefined && !isPromotion(promotionRaw)) {
      return { ok: false, code: CHESS_ERROR.INVALID_PROMOTION, sequence: this.state.sequence };
    }

    const legal = this.chess.moves({ square: from as Square, verbose: true });
    const matches = legal.filter((m) => m.to === to);
    if (matches.length === 0) {
      return { ok: false, code: CHESS_ERROR.ILLEGAL_MOVE, sequence: this.state.sequence };
    }
    if (matches.some((m) => m.promotion) && !isPromotion(promotionRaw)) {
      this.state.status = CHESS_GAME_STATUS.WAITING_FOR_PROMOTION;
      return { ok: false, code: CHESS_ERROR.PROMOTION_REQUIRED, sequence: this.state.sequence };
    }

    let applied: Move;
    try {
      applied = this.chess.move({
        from,
        to,
        promotion: isPromotion(promotionRaw) ? promotionRaw : undefined,
      });
    } catch {
      return { ok: false, code: CHESS_ERROR.ILLEGAL_MOVE, sequence: this.state.sequence };
    }

    this.state.clocks = afterMove(this.state.clocks, color, now, CHESS_MVP.incrementMs);
    this.state.sequence += 1;
    this.state.fen = this.chess.fen();
    this.state.pgn = this.chess.pgn();
    this.state.turn = colorFromTurn(this.chess.turn());
    this.state.inCheck = this.chess.inCheck();
    this.state.status = CHESS_GAME_STATUS.PLAYING;
    const promotion = applied.promotion && isPromotion(applied.promotion) ? applied.promotion : undefined;
    const lastMove: ChessLastMove = {
      from: applied.from,
      to: applied.to,
      san: applied.san,
      promotion,
      captured: applied.captured,
    };
    this.state.lastMove = lastMove;
    this.state.moves = [
      ...this.state.moves,
      { ...lastMove, color, fen: this.state.fen },
    ];

    const declinedDraw = this.state.drawOfferBy;
    this.state.drawOfferBy = null;

    const events: ChessDomainEvent[] = [
      {
        type: "MOVED",
        payload: {
          playerId: command.playerId,
          color,
          from: applied.from,
          to: applied.to,
          san: applied.san,
          promotion,
          captured: applied.captured,
          fen: this.state.fen,
          inCheck: this.state.inCheck,
          isCheckmate: this.chess.isCheckmate(),
          isDraw: this.chess.isDraw() && !this.chess.isCheckmate(),
          clocks: {
            whiteTimeMs: remainingMs(this.state.clocks, "WHITE", now),
            blackTimeMs: remainingMs(this.state.clocks, "BLACK", now),
            runningColor: this.state.clocks.runningColor,
          },
          sequence: this.state.sequence,
        },
      },
    ];

    if (declinedDraw) {
      events.push({
        type: "DRAW_RESOLVED",
        payload: { accepted: false, byPlayerId: command.playerId, sequence: this.state.sequence },
      });
    }

    const end = evaluateEndReason(this.chess);
    if (end) {
      this.finish(
        now,
        end,
        end === END_REASON.CHECKMATE ? color : null,
        end === END_REASON.CHECKMATE ? command.playerId ?? null : null,
      );
      events.push({ type: "GAME_ENDED", payload: this.endedPayload() });
    }

    events.push({ type: "CLOCK_SYNC", payload: this.clockPayload(now) });
    return { ok: true, sequence: this.state.sequence, state: this.state, events };
  }

  private resign(command: ChessEngineCommand, now: number): ChessActionResult {
    const colorOrErr = this.requireLivePlayer(command.playerId);
    if (typeof colorOrErr !== "string") {
      if (!this.isLive()) {
        return { ok: false, code: CHESS_ERROR.RESIGN_NOT_ALLOWED, sequence: this.state.sequence };
      }
      return colorOrErr;
    }
    const winnerColor = opposite(colorOrErr);
    this.state.sequence += 1;
    this.finish(now, END_REASON.RESIGN, winnerColor, this.playerIdFor(winnerColor));
    return {
      ok: true,
      sequence: this.state.sequence,
      state: this.state,
      events: [
        { type: "GAME_ENDED", payload: this.endedPayload() },
        { type: "CLOCK_SYNC", payload: this.clockPayload(now) },
      ],
    };
  }

  private offerDraw(command: ChessEngineCommand, now: number): ChessActionResult {
    const colorOrErr = this.requireLivePlayer(command.playerId);
    if (typeof colorOrErr !== "string") return colorOrErr;
    if (this.state.drawOfferBy) {
      return { ok: false, code: CHESS_ERROR.DRAW_ALREADY_OFFERED, sequence: this.state.sequence };
    }
    this.state.drawOfferBy = command.playerId ?? null;
    this.state.status = CHESS_GAME_STATUS.WAITING_FOR_DRAW;
    this.state.sequence += 1;
    return {
      ok: true,
      sequence: this.state.sequence,
      state: this.state,
      events: [
        {
          type: "DRAW_OFFERED",
          payload: {
            playerId: command.playerId,
            byPlayerId: command.playerId,
            byUserId:
              colorOrErr === "WHITE" ? this.state.whiteUserId : this.state.blackUserId,
            byColor: colorOrErr,
            color: colorOrErr,
            drawOffer: this.publicDrawOffer(),
            sequence: this.state.sequence,
          },
        },
        { type: "CLOCK_SYNC", payload: this.clockPayload(now) },
      ],
    };
  }

  private respondDraw(command: ChessEngineCommand, now: number): ChessActionResult {
    const colorOrErr = this.requireLivePlayer(command.playerId);
    if (typeof colorOrErr !== "string") return colorOrErr;
    if (!this.state.drawOfferBy) {
      return { ok: false, code: CHESS_ERROR.DRAW_NOT_PENDING, sequence: this.state.sequence };
    }
    if (this.state.drawOfferBy === command.playerId) {
      return { ok: false, code: CHESS_ERROR.DRAW_NOT_PENDING, sequence: this.state.sequence };
    }
    const accept = Boolean(command.payload?.accept);
    this.state.sequence += 1;
    this.state.drawOfferBy = null;
    if (!accept) {
      this.state.status = CHESS_GAME_STATUS.PLAYING;
      return {
        ok: true,
        sequence: this.state.sequence,
        state: this.state,
        events: [
          {
            type: "DRAW_RESOLVED",
            payload: { accepted: false, byPlayerId: command.playerId, sequence: this.state.sequence },
          },
        ],
      };
    }
    this.finish(now, END_REASON.AGREED_DRAW, null, null);
    return {
      ok: true,
      sequence: this.state.sequence,
      state: this.state,
      events: [
        {
          type: "DRAW_RESOLVED",
          payload: { accepted: true, byPlayerId: command.playerId, sequence: this.state.sequence },
        },
        { type: "GAME_ENDED", payload: this.endedPayload() },
        { type: "CLOCK_SYNC", payload: this.clockPayload(now) },
      ],
    };
  }

  private timeout(now: number): ChessActionResult {
    if (!this.isLive()) {
      return { ok: false, code: CHESS_ERROR.GAME_NOT_PLAYING, sequence: this.state.sequence };
    }
    const flagged = timedOutColor(this.state.clocks, now) ?? this.state.turn;
    const opponent = opposite(flagged);
    this.state.sequence += 1;
    if (opponentHasInsufficientMaterial(this.chess, opponent)) {
      this.finish(now, END_REASON.TIMEOUT_VS_INSUFFICIENT, null, null);
    } else {
      this.finish(now, END_REASON.TIMEOUT, opponent, this.playerIdFor(opponent));
    }
    return {
      ok: true,
      sequence: this.state.sequence,
      state: this.state,
      events: [
        { type: "GAME_ENDED", payload: this.endedPayload() },
        { type: "CLOCK_SYNC", payload: this.clockPayload(now) },
      ],
    };
  }

  private playerLeft(command: ChessEngineCommand, now: number): ChessActionResult {
    if (!this.isLive()) {
      return { ok: false, code: CHESS_ERROR.GAME_ALREADY_FINISHED, sequence: this.state.sequence };
    }
    const color = command.playerId ? this.playerColor(command.playerId) : null;
    if (!color) {
      return { ok: false, code: CHESS_ERROR.NOT_ROOM_MEMBER };
    }
    const winnerColor = opposite(color);
    this.state.sequence += 1;
    this.finish(now, END_REASON.OPPONENT_LEFT, winnerColor, this.playerIdFor(winnerColor));
    return {
      ok: true,
      sequence: this.state.sequence,
      state: this.state,
      events: [
        { type: "GAME_ENDED", payload: this.endedPayload() },
        { type: "CLOCK_SYNC", payload: this.clockPayload(now) },
      ],
    };
  }

  private abort(command: ChessEngineCommand, now: number): ChessActionResult {
    if (
      this.state.status === CHESS_GAME_STATUS.FINISHED ||
      this.state.status === CHESS_GAME_STATUS.ABORTED
    ) {
      return { ok: false, code: CHESS_ERROR.GAME_ALREADY_FINISHED, sequence: this.state.sequence };
    }
    const reason =
      (command.payload?.reason as ChessEndReason | undefined) ?? END_REASON.HOST_CLOSED;
    this.state.sequence += 1;
    this.state.clocks = stopClocks(this.state.clocks, now);
    this.state.status = CHESS_GAME_STATUS.ABORTED;
    this.state.winnerId = null;
    this.state.winnerColor = null;
    this.state.endReason = reason;
    this.state.drawOfferBy = null;
    return {
      ok: true,
      sequence: this.state.sequence,
      state: this.state,
      events: [
        { type: "GAME_ENDED", payload: this.endedPayload() },
        { type: "CLOCK_SYNC", payload: this.clockPayload(now) },
      ],
    };
  }

  private finish(
    now: number,
    reason: ChessEndReason,
    winnerColor: ChessColor | null,
    winnerId: string | null,
  ) {
    this.state.clocks = stopClocks(this.state.clocks, now);
    this.state.status = CHESS_GAME_STATUS.FINISHED;
    this.state.endReason = reason;
    this.state.winnerColor = winnerColor;
    this.state.winnerId = winnerId;
    this.state.drawOfferBy = null;
    this.state.fen = this.chess.fen();
    this.state.pgn = this.chess.pgn();
  }

  private clockPayload(now: number) {
    const running = this.state.clocks.runningColor;
    return {
      whiteTimeMs: remainingMs(this.state.clocks, "WHITE", now),
      blackTimeMs: remainingMs(this.state.clocks, "BLACK", now),
      runningColor: running,
      lastStartedAt: running ? now : null,
      turn: this.state.turn,
      serverTime: new Date(now).toISOString(),
      sequence: this.state.sequence,
    };
  }

  private publicDrawOffer() {
    if (!this.state.drawOfferBy) return null;
    const byColor = this.playerColor(this.state.drawOfferBy);
    return {
      byPlayerId: this.state.drawOfferBy,
      byUserId:
        this.state.drawOfferBy === this.state.whitePlayerId
          ? this.state.whiteUserId
          : this.state.drawOfferBy === this.state.blackPlayerId
            ? this.state.blackUserId
            : undefined,
      byColor: byColor ?? undefined,
    };
  }

  private publicMoves() {
    return this.state.moves.map((move, index) => ({
      ply: index + 1,
      from: move.from,
      to: move.to,
      san: move.san,
      piece: "",
      captured: move.captured,
      promotion: move.promotion,
      color: move.color,
      isCheck: move.san.includes("+") || move.san.includes("#"),
      isCheckmate: move.san.includes("#"),
      fenAfter: move.fen,
    }));
  }

  startedPayload(now = Date.now()) {
    return {
      ...this.publicGame(now),
      whitePlayerId: this.state.whitePlayerId,
      blackPlayerId: this.state.blackPlayerId,
    };
  }

  endedPayload() {
    return {
      winnerColor: this.state.winnerColor,
      winnerId: this.state.winnerId,
      reason: this.state.endReason,
      fen: this.state.fen,
      pgn: this.state.pgn,
      sequence: this.state.sequence,
    };
  }

  publicGame(now = Date.now()) {
    const clocks = this.clockPayload(now);
    return {
      gameId: this.state.gameId,
      status: this.state.status,
      sequence: this.state.sequence,
      fen: this.state.fen,
      pgn: this.state.pgn,
      moves: this.publicMoves(),
      clocks: {
        whiteTimeMs: clocks.whiteTimeMs,
        blackTimeMs: clocks.blackTimeMs,
        runningColor: clocks.runningColor,
        lastStartedAt: clocks.lastStartedAt,
      },
      turn: this.state.turn,
      inCheck: this.state.inCheck,
      lastMove: this.state.lastMove,
      drawOffer: this.publicDrawOffer(),
      winnerColor: this.state.winnerColor,
      winnerId: this.state.winnerId,
      endReason: this.state.endReason,
    };
  }
}

export type ChessStartResult = ChessActionOk & { engine: ChessEngine };
