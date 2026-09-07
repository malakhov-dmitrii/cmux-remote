import {
  type Delivery,
  isRecord,
  parseSurfaces,
  parseWorkspaces,
  RemoteError,
  type RpcError,
  type RpcRequest,
  type RpcResponse,
} from "../../shared/protocol";
import { createRemoteTarget } from "./creation";
import { InputState } from "./input-state";

export type Executor = (method: string, params: Record<string, unknown>) => Promise<unknown>;
const writes = new Set<string>();
const defaultState = new InputState();
export function rpcFailure(id: string, error: unknown, delivery?: Delivery): RpcResponse {
  const failure: RpcError =
    error instanceof RemoteError
      ? {
          code: error.code,
          message: error.message,
          delivery: delivery ?? error.delivery,
          ...(error.detail ? { detail: error.detail } : {}),
        }
      : {
          code: "upstream_error",
          message: "The cmux request did not complete.",
          delivery: delivery ?? "not_sent",
          ...(error instanceof Error ? { detail: error.message } : {}),
        };
  return { id, ok: false, error: failure };
}
function acknowledged(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || value.ok === false || Object.hasOwn(value, "error"))
    throw new RemoteError("invalid_response", "cmux did not acknowledge the operation.");
  return value;
}
export async function handleRpc(
  request: RpcRequest,
  execute: Executor,
  state = defaultState,
  active = () => true,
): Promise<RpcResponse> {
  let locked: string | undefined;
  let mutationStarted = false;
  let textInserted = false;
  const assertActive = () => {
    if (!active())
      throw new RemoteError(
        "connection_closed",
        "The connection closed before the operation finished.",
      );
  };
  try {
    assertActive();
    if (request.method === "workspace.create" || request.method === "surface.create")
      return {
        id: request.id,
        ok: true,
        result: await createRemoteTarget(request, execute, active),
      };
    if (request.method === "workspace.list")
      return {
        id: request.id,
        ok: true,
        result: { workspaces: parseWorkspaces(await execute("workspace.list", {})) },
      };
    const workspace = request.params.workspace_ref;
    if (request.method === "surface.list")
      return {
        id: request.id,
        ok: true,
        result: {
          surfaces: parseSurfaces(await execute("surface.list", { workspace_id: workspace })),
        },
      };
    const surface = request.params.surface_ref;
    const routing = { workspace_id: workspace, surface_id: surface };
    if (request.method === "surface.read_text") {
      const result = await execute(request.method, { ...routing, lines: 200 });
      if (!isRecord(result) || typeof result.text !== "string")
        throw new RemoteError("invalid_response", "cmux returned an invalid terminal snapshot.");
      return { id: request.id, ok: true, result: { text: result.text } };
    }
    const target = surface.toLowerCase();
    if (writes.has(target))
      throw new RemoteError("busy", "Input is already in progress for this terminal.");
    writes.add(target);
    locked = target;
    const recovering =
      request.method === "surface.send_key" &&
      request.params.key === "ctrl+c" &&
      request.params.confirmRecovery === true;
    const pending = await state.pending(workspace, surface);
    if (pending && !recovering)
      throw new RemoteError(
        "recovery_required",
        "Confirm Ctrl+C recovery before sending more input.",
        "unknown",
      );
    const surfaces = parseSurfaces(await execute("surface.list", { workspace_id: workspace }));
    if (!surfaces.some((item) => item.id.toLowerCase() === target && item.type === "terminal")) {
      throw new RemoteError(
        "invalid_request",
        "The selected terminal is no longer in this workspace. Select another terminal.",
      );
    }
    assertActive();
    if (!pending) await state.begin(workspace, surface);
    assertActive();
    mutationStarted = true;
    let result: Record<string, unknown>;
    if (request.method === "surface.send_key") {
      result = acknowledged(await execute(request.method, { ...routing, key: request.params.key }));
    } else {
      result = acknowledged(
        await execute("surface.send_text", { ...routing, text: request.params.text }),
      );
      textInserted = true;
      assertActive();
      if (request.method === "surface.submit")
        result = acknowledged(await execute("surface.send_key", { ...routing, key: "enter" }));
    }
    assertActive();
    await state.acknowledge(workspace, surface);
    return { id: request.id, ok: true, result };
  } catch (error) {
    return rpcFailure(
      request.id,
      error,
      textInserted ? "text_inserted" : mutationStarted ? "unknown" : undefined,
    );
  } finally {
    if (locked) writes.delete(locked);
  }
}
