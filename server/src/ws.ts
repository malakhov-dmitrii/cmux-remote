import {
  decodeRpcRequest,
  isRecord,
  MAX_REQUEST_LENGTH,
  RemoteError,
  type RpcRequest,
} from "../../shared/protocol";
import { executeCmux } from "./cmux-cli";
import { InputState } from "./input-state";
import { type Executor, handleRpc, rpcFailure } from "./rpc";
export interface WSData {
  active: boolean;
  inFlight: number;
  seen: Set<string>;
}
export interface WSConnection {
  data: WSData;
  send(message: string): unknown;
}
export function createWebSocketHandler(execute: Executor = executeCmux, state = new InputState()) {
  return {
    maxPayloadLength: 32_768,
    idleTimeout: 60,
    sendPings: true,
    async message(ws: WSConnection, message: string | Buffer) {
      if (!ws.data.active) return;
      let id = "0";
      let request: RpcRequest;
      try {
        const text = typeof message === "string" ? message : message.toString();
        if (text.length > MAX_REQUEST_LENGTH)
          throw new RemoteError("invalid_request", "Request is too large.");
        const parsed: unknown = JSON.parse(text);
        if (
          isRecord(parsed) &&
          typeof parsed.id === "string" &&
          parsed.id.length > 0 &&
          parsed.id.length <= 80
        )
          id = parsed.id;
        request = decodeRpcRequest(parsed);
      } catch (error) {
        ws.send(
          JSON.stringify(
            rpcFailure(
              id,
              error instanceof RemoteError
                ? error
                : new RemoteError("invalid_request", "Invalid JSON request."),
            ),
          ),
        );
        return;
      }
      if (ws.data.seen.has(id) || ws.data.inFlight >= 8) {
        ws.send(
          JSON.stringify(
            rpcFailure(id, new RemoteError("busy", "Duplicate or excessive request rejected.")),
          ),
        );
        return;
      }
      ws.data.seen.add(id);
      if (ws.data.seen.size > 1_000) {
        const first = ws.data.seen.values().next().value;
        if (first !== undefined) ws.data.seen.delete(first);
      }
      ws.data.inFlight++;
      try {
        const result = await handleRpc(request, execute, state, () => ws.data.active);
        if (ws.data.active) ws.send(JSON.stringify(result));
      } finally {
        ws.data.inFlight--;
      }
    },
    close(ws: WSConnection) {
      ws.data.active = false;
    },
  };
}
