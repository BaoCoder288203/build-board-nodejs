import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppError } from "../../../common/app-error.js";
import { mergeRules, lobbyStatus } from "../room/room.service.js";

describe("room join guards", () => {
  it("rejects stacking / jump-in / seven-o at create", () => {
    assert.throws(
      () => mergeRules({ stacking: true }),
      (err: unknown) => err instanceof AppError && err.code === "UNSUPPORTED_RULE",
    );
    assert.throws(
      () => mergeRules({ jumpIn: true }),
      (err: unknown) => err instanceof AppError && err.code === "UNSUPPORTED_RULE",
    );
    assert.throws(
      () => mergeRules({ sevenZero: true }),
      (err: unknown) => err instanceof AppError && err.code === "UNSUPPORTED_RULE",
    );
  });

  it("marks the lobby READY only with 2+ ready players", () => {
    assert.equal(
      lobbyStatus([{ status: "READY", isSpectator: false }]),
      "WAITING",
    );
    assert.equal(
      lobbyStatus([
        { status: "READY", isSpectator: false },
        { status: "WAITING", isSpectator: false },
      ]),
      "WAITING",
    );
    assert.equal(
      lobbyStatus([
        { status: "READY", isSpectator: false },
        { status: "READY", isSpectator: false },
      ]),
      "READY",
    );
  });
});
