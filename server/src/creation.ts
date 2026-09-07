import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import {
  type CreatedTarget,
  isRecord,
  isUuid,
  normalizeWorkspaceOptions,
  parseCreatedTarget,
  RemoteError,
  type RpcRequest,
} from "../../shared/protocol";
import type { Executor } from "./rpc";

type CreationRequest = Extract<RpcRequest, { method: "workspace.create" | "surface.create" }>;
interface NativeSurface {
  id: string;
  paneId: string;
  type: string;
}
let creating = false;
const sameId = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
const invalidMetadata = () =>
  new RemoteError("invalid_response", "cmux returned invalid creation metadata.");

function workspaceContext(value: unknown) {
  if (!isRecord(value) || !isUuid(value.window_id) || !Array.isArray(value.workspaces))
    throw invalidMetadata();
  const workspaces = value.workspaces.map((item: unknown) => {
    if (!isRecord(item) || !isUuid(item.id)) throw invalidMetadata();
    return { id: item.id, remote: isRecord(item.remote) && item.remote.enabled === true };
  });
  return { windowId: value.window_id, workspaces };
}
function surfaceContext(value: unknown, workspaceId: string, windowId?: string) {
  if (
    !isRecord(value) ||
    !isUuid(value.window_id) ||
    !isUuid(value.workspace_id) ||
    !sameId(value.workspace_id, workspaceId) ||
    (windowId && !sameId(value.window_id, windowId)) ||
    !Array.isArray(value.surfaces)
  )
    throw invalidMetadata();
  const surfaces: NativeSurface[] = value.surfaces.map((item: unknown) => {
    if (
      !isRecord(item) ||
      !isUuid(item.id) ||
      !isUuid(item.pane_id) ||
      typeof item.type !== "string"
    )
      throw invalidMetadata();
    return { id: item.id, paneId: item.pane_id, type: item.type };
  });
  return { windowId: value.window_id, surfaces };
}
async function workingDirectory(cwd: string | undefined): Promise<string> {
  const path =
    !cwd || cwd === "~" ? homedir() : cwd.startsWith("~/") ? resolve(homedir(), cwd.slice(2)) : cwd;
  if (!isAbsolute(path))
    throw new RemoteError(
      "invalid_request",
      "Directory must be an absolute path or start with ~/.",
    );
  try {
    if (!(await stat(path)).isDirectory()) throw new Error("Not a directory.");
    await access(path, constants.R_OK | constants.X_OK);
  } catch {
    throw new RemoteError(
      "invalid_request",
      "The directory does not exist or cannot be opened by this user.",
    );
  }
  return path;
}

async function ensureReadable(
  target: CreatedTarget,
  windowId: string,
  execute: Executor,
  assertActive: () => void,
): Promise<void> {
  const routing = { window_id: windowId, ...target };
  assertActive();
  // The native replay call starts an unmounted terminal without focus or viewport changes.
  const replay = await execute("terminal.replay", routing);
  assertActive();
  if (
    !isRecord(replay) ||
    !isUuid(replay.workspace_id) ||
    !sameId(replay.workspace_id, target.workspace_id) ||
    !isUuid(replay.surface_id) ||
    !sameId(replay.surface_id, target.surface_id)
  )
    throw invalidMetadata();
  const deadline = Date.now() + 1_000;
  let detail: string | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    assertActive();
    try {
      const snapshot = await execute("surface.read_text", { ...routing, lines: 1 });
      assertActive();
      if (isRecord(snapshot) && typeof snapshot.text === "string") return;
      detail = "cmux returned an invalid terminal snapshot.";
    } catch (error) {
      detail = error instanceof Error ? error.message : undefined;
    }
    assertActive();
    if (attempt === 2 || Date.now() >= deadline) break;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    assertActive();
    if (Date.now() >= deadline) break;
  }
  throw new RemoteError(
    "upstream_unavailable",
    "The new terminal did not become readable. Check sessions before trying again.",
    "unknown",
    detail,
  );
}

export async function createRemoteTarget(
  request: CreationRequest,
  execute: Executor,
  active: () => boolean,
): Promise<CreatedTarget> {
  if (creating)
    throw new RemoteError("busy", "Another creation request is in progress. Wait for its result.");
  creating = true;
  let dispatched = false;
  const assertActive = () => {
    if (!active())
      throw new RemoteError(
        "connection_closed",
        "The connection closed before creation was confirmed.",
      );
  };
  try {
    assertActive();
    if (request.method === "workspace.create") {
      const options = normalizeWorkspaceOptions({ ...request.params });
      const directory = await workingDirectory(options.cwd);
      const context = workspaceContext(await execute("workspace.list", {}));
      assertActive();
      dispatched = true;
      const result = await execute("workspace.create", {
        window_id: context.windowId,
        ...(options.name ? { title: options.name } : {}),
        working_directory: directory,
        focus: false,
        operation_id: randomUUID(),
      });
      assertActive();
      if (
        !isRecord(result) ||
        !isUuid(result.window_id) ||
        !sameId(result.window_id, context.windowId) ||
        !isUuid(result.workspace_id) ||
        (result.surface_id !== null && !isUuid(result.surface_id))
      )
        throw invalidMetadata();
      const newWorkspace = result.workspace_id;
      const newSurface = result.surface_id;
      if (context.workspaces.some((item) => sameId(item.id, newWorkspace))) throw invalidMetadata();
      const readback = surfaceContext(
        await execute("surface.list", { workspace_id: newWorkspace }),
        newWorkspace,
        context.windowId,
      );
      assertActive();
      const terminal =
        newSurface === null
          ? readback.surfaces.find((item) => item.type === "terminal")
          : readback.surfaces.find(
              (item) => sameId(item.id, newSurface) && item.type === "terminal",
            );
      if (!terminal) throw invalidMetadata();
      const target = parseCreatedTarget({ workspace_id: newWorkspace, surface_id: terminal.id });
      await ensureReadable(target, context.windowId, execute, assertActive);
      return target;
    }
    const { workspace_ref: workspace, surface_ref: anchor } = request.params;
    const context = surfaceContext(
      await execute("surface.list", { workspace_id: workspace }),
      workspace,
    );
    const source = context.surfaces.find(
      (item) => sameId(item.id, anchor) && item.type === "terminal",
    );
    if (!source)
      throw new RemoteError(
        "invalid_request",
        "The selected terminal is no longer available. Choose another terminal.",
      );
    const windows = workspaceContext(
      await execute("workspace.list", { window_id: context.windowId }),
    );
    const targetWorkspace = windows.workspaces.find((item) => sameId(item.id, workspace));
    if (!sameId(windows.windowId, context.windowId) || !targetWorkspace) throw invalidMetadata();
    if (targetWorkspace.remote)
      throw new RemoteError(
        "invalid_request",
        "New terminals are unavailable for remote workspaces.",
      );
    assertActive();
    dispatched = true;
    const result = await execute("surface.create", {
      window_id: context.windowId,
      workspace_id: workspace,
      pane_id: source.paneId,
      type: "terminal",
      focus: false,
    });
    assertActive();
    const target = parseCreatedTarget(result);
    if (
      !isRecord(result) ||
      !isUuid(result.window_id) ||
      !sameId(result.window_id, context.windowId) ||
      !sameId(target.workspace_id, workspace) ||
      !isUuid(result.pane_id) ||
      !sameId(result.pane_id, source.paneId) ||
      result.type !== "terminal" ||
      context.surfaces.some((item) => sameId(item.id, target.surface_id))
    )
      throw invalidMetadata();
    const readback = surfaceContext(
      await execute("surface.list", { workspace_id: workspace }),
      workspace,
      context.windowId,
    );
    assertActive();
    if (
      !readback.surfaces.some(
        (item) =>
          sameId(item.id, target.surface_id) &&
          sameId(item.paneId, source.paneId) &&
          item.type === "terminal",
      )
    )
      throw invalidMetadata();
    await ensureReadable(target, context.windowId, execute, assertActive);
    return target;
  } catch (error) {
    if (error instanceof RemoteError)
      throw new RemoteError(
        error.code,
        error.message,
        dispatched ? "unknown" : "not_sent",
        error.detail,
      );
    throw new RemoteError(
      "upstream_error",
      "Creation was not confirmed. Check sessions before trying again.",
      dispatched ? "unknown" : "not_sent",
      error instanceof Error ? error.message : undefined,
    );
  } finally {
    creating = false;
  }
}
