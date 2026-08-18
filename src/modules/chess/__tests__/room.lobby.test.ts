import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lobbyStatus } from "../room/room.service.js";

describe("chess lobby", () => {
  it("stays WAITING until exactly 2 contestants are ready", () => {
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
    assert.equal(
      lobbyStatus([
        { status: "READY", isSpectator: false },
        { status: "READY", isSpectator: false },
        { status: "READY", isSpectator: true },
      ]),
      "READY",
    );
  });
});
