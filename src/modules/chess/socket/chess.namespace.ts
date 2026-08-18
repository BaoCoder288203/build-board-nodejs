import type { Namespace } from "socket.io";

let namespace: Namespace | null = null;

export function bindChessRealtime(ns: Namespace) {
  namespace = ns;
}

export function getChessNamespace() {
  return namespace;
}
