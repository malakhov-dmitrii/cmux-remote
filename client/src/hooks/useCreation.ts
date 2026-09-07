import { useCallback, useRef, useState } from "react";
import {
  type CreatedTarget,
  isUuid,
  normalizeWorkspaceOptions,
  parseCreatedTarget,
  RemoteError,
  type RpcError,
  type RpcMethod,
  type WorkspaceOptions,
} from "../../../shared/protocol";

export interface CreationSelection {
  workspace: string | null;
  surface: string | null;
  revision: number;
}

interface CreationOptions {
  connected: boolean;
  terminalAvailable: boolean;
  rpc: (method: RpcMethod, params: Record<string, unknown>) => Promise<unknown>;
  getSelection: () => CreationSelection;
  onCreated: (target: CreatedTarget) => void;
}

export function useCreation({
  connected,
  terminalAvailable,
  rpc,
  getSelection,
  onCreated,
}: CreationOptions) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RpcError | null>(null);
  const busyRef = useRef(false);
  const errorRef = useRef<RpcError | null>(null);

  const create = useCallback(
    async (
      method: "workspace.create" | "surface.create",
      options: WorkspaceOptions = {},
    ): Promise<boolean> => {
      if (
        !connected ||
        busyRef.current ||
        errorRef.current ||
        (method === "surface.create" && !terminalAvailable)
      )
        return false;
      const source = { ...getSelection() };
      busyRef.current = true;
      setBusy(true);
      try {
        let params: Record<string, unknown>;
        if (method === "workspace.create")
          params = { ...normalizeWorkspaceOptions({ ...options }) };
        else {
          if (!isUuid(source.workspace) || !isUuid(source.surface))
            throw new RemoteError("invalid_request", "Select a terminal first.");
          params = { workspace_ref: source.workspace, surface_ref: source.surface };
        }
        const target = parseCreatedTarget(await rpc(method, params));
        if (
          method === "surface.create" &&
          target.workspace_id.toLowerCase() !== source.workspace?.toLowerCase()
        ) {
          throw new RemoteError(
            "invalid_response",
            "The bridge returned a different workspace.",
            "unknown",
          );
        }
        if (getSelection().revision === source.revision) onCreated(target);
        return true;
      } catch (caught) {
        const failure: RpcError =
          caught instanceof RemoteError
            ? {
                code: caught.code,
                message: caught.message,
                delivery: caught.delivery,
                ...(caught.detail ? { detail: caught.detail } : {}),
              }
            : {
                code: "upstream_error",
                message: "Creation was not confirmed.",
                delivery: "unknown",
              };
        errorRef.current = failure;
        setError(failure);
        return false;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [connected, terminalAvailable, rpc, getSelection, onCreated],
  );

  const createWorkspace = useCallback(
    (options: WorkspaceOptions = {}) => create("workspace.create", options),
    [create],
  );
  const createTerminal = useCallback(() => create("surface.create"), [create]);
  const acknowledgeError = useCallback(() => {
    if (busyRef.current) return;
    errorRef.current = null;
    setError(null);
  }, []);

  return {
    busy,
    error,
    canCreateWorkspace: connected && !busy && !error,
    canCreateTerminal: connected && terminalAvailable && !busy && !error,
    createWorkspace,
    createTerminal,
    acknowledgeError,
  };
}

export type CreationState = ReturnType<typeof useCreation>;
