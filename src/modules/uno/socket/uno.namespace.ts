import type { Namespace } from "socket.io";

let namespace: Namespace | null = null;

export function bindUnoRealtime(ns: Namespace) {
  namespace = ns;
}

export function getUnoNamespace() {
  return namespace;
}
