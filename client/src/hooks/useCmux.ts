import { useCallback, useEffect, useRef, useState } from "react";
import {
  createRpcRequest,
  type Delivery,
  isRecord,
  isUuid,
  isValidInputText,
  parseRpcResponse,
  parseSurfaces,
  parseWorkspaces,
  RemoteError,
  type RpcError,
  type RpcMethod,
  type Surface,
  type Workspace,
} from "../../../shared/protocol";
import { useWebSocket } from "./useWebSocket";

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  sent: boolean;
}
interface Target {
  readonly workspace: string | null;
  readonly surface: string | null;
}
const POLL_INTERVAL = 1000;
const FRESH_FOR = 5000;
const targetKey = (target: Target) => `${target.workspace ?? ""}/${target.surface ?? ""}`;
const SELECTION_KEY = "cmux-remote.selection";

function needsRecovery(error: RpcError | undefined): boolean {
  return !!error && (error.code === "recovery_required" || error.delivery !== "not_sent");
}

function failure(error: unknown, delivery: Delivery): RpcError {
  if (error instanceof RemoteError)
    return {
      code: error.code,
      message: error.message,
      delivery: error.delivery,
      ...(error.detail ? { detail: error.detail } : {}),
    };
  return {
    code: "upstream_error",
    message: "The request failed.",
    delivery,
    ...(error instanceof Error ? { detail: error.message } : {}),
  };
}

function restoreTarget(): Target {
  try {
    const stored: unknown = JSON.parse(window.sessionStorage.getItem(SELECTION_KEY) ?? "null");
    if (isRecord(stored) && isUuid(stored.workspace) && isUuid(stored.surface)) {
      return { workspace: stored.workspace, surface: stored.surface };
    }
  } catch {
    /* Storage is optional; live selection still works. */
  }
  return { workspace: null, surface: null };
}

function rememberTarget(target: Target) {
  if (!isUuid(target.workspace) || !isUuid(target.surface)) return;
  try {
    window.sessionStorage.setItem(SELECTION_KEY, JSON.stringify(target));
  } catch {
    /* Storage is optional; live selection still works. */
  }
}

export function useCmux() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  const [surfacesLoaded, setSurfacesLoaded] = useState(false);
  const [selection, setSelection] = useState<Target>(restoreTarget);
  const [content, setContent] = useState("");
  const [fresh, setFresh] = useState(false);
  const [lastReadAt, setLastReadAt] = useState<number | null>(null);
  const [readError, setReadError] = useState<RpcError | null>(null);
  const [inputErrors, setInputErrors] = useState<Record<string, RpcError>>({});
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const targetRef = useRef(selection);
  const version = useRef(0);
  const freshUntil = useRef(0);
  const freshnessTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef(new Map<string, PendingRequest>());
  const sendingRef = useRef(false);
  const errorsRef = useRef(inputErrors);
  const requireWorkspaceSelection = useRef(false);
  const requireSurfaceSelection = useRef(false);

  const invalidate = useCallback(() => {
    freshUntil.current = 0;
    setFresh(false);
    clearTimeout(freshnessTimer.current);
  }, []);

  const rejectPending = useCallback((error: RemoteError) => {
    for (const request of pending.current.values()) {
      clearTimeout(request.timer);
      request.reject(
        new RemoteError(
          error.code,
          error.message,
          request.sent ? "unknown" : "not_sent",
          error.detail,
        ),
      );
    }
    pending.current.clear();
  }, []);

  const handleDisconnect = useCallback(() => {
    version.current++;
    invalidate();
    rejectPending(new RemoteError("connection_closed", "Connection to the bridge closed."));
  }, [invalidate, rejectPending]);

  const handleMessage = useCallback(
    (data: string) => {
      try {
        const response = parseRpcResponse(data);
        const request = pending.current.get(response.id);
        if (!request) return;
        clearTimeout(request.timer);
        pending.current.delete(response.id);
        if (response.ok) request.resolve(response.result);
        else
          request.reject(
            new RemoteError(
              response.error.code,
              response.error.message,
              response.error.delivery,
              response.error.detail,
            ),
          );
      } catch {
        invalidate();
        const error = new RemoteError(
          "invalid_response",
          "The bridge returned an invalid response.",
        );
        setReadError(failure(error, "not_sent"));
        rejectPending(error);
      }
    },
    [invalidate, rejectPending],
  );

  const { status, send, reconnect } = useWebSocket({
    url: `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`,
    onMessage: handleMessage,
    onDisconnect: handleDisconnect,
  });

  const rpc = useCallback(
    (method: RpcMethod, params: Record<string, unknown> = {}): Promise<unknown> => {
      return new Promise((resolve, reject) => {
        const request = createRpcRequest(method, params);
        const timer = setTimeout(() => {
          pending.current.delete(request.id);
          reject(
            new RemoteError(
              "upstream_unavailable",
              "The bridge did not reply within 10 seconds.",
              "unknown",
            ),
          );
        }, 10_000);
        const queued: PendingRequest = { resolve, reject, timer, sent: false };
        pending.current.set(request.id, queued);
        try {
          queued.sent = send(JSON.stringify(request));
          if (!queued.sent)
            throw new RemoteError("connection_closed", "Not connected to the bridge.");
        } catch (error) {
          clearTimeout(timer);
          pending.current.delete(request.id);
          reject(error);
        }
      });
    },
    [send],
  );

  const chooseTarget = useCallback(
    (next: Target) => {
      if (targetKey(next) === targetKey(targetRef.current)) return;
      if (next.workspace !== targetRef.current.workspace) setSurfacesLoaded(false);
      version.current++;
      invalidate();
      targetRef.current = next;
      rememberTarget(next);
      setSelection(next);
      setContent("");
      setLastReadAt(null);
      setReadError(null);
    },
    [invalidate],
  );

  const selectWorkspace = useCallback(
    (id: string) => {
      if (
        id === targetRef.current.workspace ||
        !workspaces.some((workspace) => workspace.id === id)
      )
        return;
      requireWorkspaceSelection.current = false;
      requireSurfaceSelection.current = false;
      setSurfaces([]);
      chooseTarget({ workspace: id, surface: null });
    },
    [workspaces, chooseTarget],
  );

  const selectSurface = useCallback(
    (id: string) => {
      if (!surfaces.some((surface) => surface.id === id && surface.type === "terminal")) return;
      requireSurfaceSelection.current = false;
      chooseTarget({ workspace: targetRef.current.workspace, surface: id });
    },
    [surfaces, chooseTarget],
  );

  useEffect(() => {
    if (status !== "connected") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      let expectedVersion = version.current;
      const stillCurrent = () => !stopped && version.current === expectedVersion;
      try {
        const nextWorkspaces = parseWorkspaces(await rpc("workspace.list"));
        if (!stillCurrent()) return;
        setWorkspaces(nextWorkspaces);
        setLoaded(true);
        let workspace = targetRef.current.workspace;
        if (workspace && !nextWorkspaces.some((item) => item.id === workspace)) {
          requireWorkspaceSelection.current = true;
          chooseTarget({ workspace: null, surface: null });
          setSurfaces([]);
          setReadError({
            code: "invalid_request",
            message: "This session closed. Choose another.",
            delivery: "not_sent",
          });
          return;
        }
        if (!workspace) {
          if (requireWorkspaceSelection.current) return;
          workspace =
            (nextWorkspaces.find((item) => item.selected) ?? nextWorkspaces[0])?.id ?? null;
          chooseTarget({ workspace, surface: null });
          expectedVersion = version.current;
        }
        if (!workspace) {
          invalidate();
          return;
        }
        const nextSurfaces = parseSurfaces(await rpc("surface.list", { workspace_ref: workspace }));
        if (!stillCurrent()) return;
        setSurfaces(nextSurfaces);
        setSurfacesLoaded(true);
        let surface = targetRef.current.surface;
        if (
          surface &&
          !nextSurfaces.some((item) => item.id === surface && item.type === "terminal")
        ) {
          requireSurfaceSelection.current = true;
          chooseTarget({ workspace, surface: null });
          setReadError({
            code: "invalid_request",
            message: "This terminal closed. Choose another.",
            delivery: "not_sent",
          });
          return;
        }
        if (!surface) {
          if (requireSurfaceSelection.current) return;
          const terminals = nextSurfaces.filter((item) => item.type === "terminal");
          surface = (terminals.find((item) => item.focused) ?? terminals[0])?.id ?? null;
          chooseTarget({ workspace, surface });
          expectedVersion = version.current;
        }
        if (!surface) {
          invalidate();
          setReadError(null);
          return;
        }
        const result = await rpc("surface.read_text", {
          workspace_ref: workspace,
          surface_ref: surface,
        });
        if (!stillCurrent()) return;
        if (!isRecord(result) || typeof result.text !== "string")
          throw new RemoteError("invalid_response", "Invalid terminal snapshot.");
        setContent(result.text);
        setReadError(null);
        const readAt = Date.now();
        setLastReadAt(readAt);
        freshUntil.current = readAt + FRESH_FOR;
        setFresh(true);
        clearTimeout(freshnessTimer.current);
        freshnessTimer.current = setTimeout(invalidate, FRESH_FOR);
      } catch (error) {
        if (!stillCurrent()) return;
        invalidate();
        setReadError(failure(error, "not_sent"));
      } finally {
        if (!stopped)
          timer = setTimeout(() => {
            void poll();
          }, POLL_INTERVAL);
      }
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      invalidate();
    };
  }, [status, rpc, chooseTarget, invalidate]);

  const clearInputError = useCallback((key: string) => {
    const next = { ...errorsRef.current };
    delete next[key];
    errorsRef.current = next;
    setInputErrors(next);
  }, []);

  const mutate = useCallback(
    async (
      method: "surface.send_text" | "surface.submit" | "surface.send_key",
      params: Record<string, unknown>,
      recovering = false,
    ): Promise<boolean> => {
      const target = { ...targetRef.current };
      const key = targetKey(target);
      if (
        status !== "connected" ||
        !target.workspace ||
        !target.surface ||
        Date.now() >= freshUntil.current ||
        sendingRef.current ||
        (errorsRef.current[key] && !recovering)
      )
        return false;
      sendingRef.current = true;
      setSending(true);
      try {
        const routing = { workspace_ref: target.workspace, surface_ref: target.surface };
        await rpc(method, { ...routing, ...params });
        if (recovering) clearInputError(key);
        return true;
      } catch (error) {
        const rejected = failure(error, "unknown");
        const terminalError: RpcError =
          recovering && needsRecovery(errorsRef.current[key]) && !needsRecovery(rejected)
            ? { ...rejected, code: "recovery_required" }
            : rejected;
        errorsRef.current = { ...errorsRef.current, [key]: terminalError };
        setInputErrors(errorsRef.current);
        if (key === targetKey(targetRef.current)) {
          version.current++;
          invalidate();
        }
        return false;
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [status, rpc, invalidate, clearInputError],
  );

  const sendText = useCallback(
    (text: string) => {
      if (!isValidInputText(text)) return Promise.resolve(false);
      return mutate("surface.send_text", { text });
    },
    [mutate],
  );
  const submitText = useCallback(
    (text: string) => {
      if (!isValidInputText(text)) return Promise.resolve(false);
      return mutate("surface.submit", { text });
    },
    [mutate],
  );
  const sendKey = useCallback(
    (key: "enter" | "ctrl+c") => mutate("surface.send_key", { key }),
    [mutate],
  );
  const recoverInput = useCallback(() => {
    if (!needsRecovery(errorsRef.current[targetKey(targetRef.current)]))
      return Promise.resolve(false);
    return mutate("surface.send_key", { key: "ctrl+c", confirmRecovery: true }, true);
  }, [mutate]);
  const acknowledgeInputError = useCallback(() => {
    if (Date.now() >= freshUntil.current) return;
    const key = targetKey(targetRef.current);
    if (needsRecovery(errorsRef.current[key])) return;
    clearInputError(key);
  }, [clearInputError]);
  const inputError = inputErrors[targetKey(selection)] ?? null;
  const recoveryRequired = needsRecovery(inputError ?? undefined);
  const ready = status === "connected" && fresh && !!selection.surface && !sending;

  return {
    status,
    workspaces,
    surfaces,
    surfacesLoaded,
    content,
    loaded,
    readError,
    inputError,
    sending,
    currentWorkspace: selection.workspace,
    currentSurface: selection.surface,
    targetKey: targetKey(selection),
    fresh,
    lastReadAt,
    canInput: ready && !inputError,
    recoveryRequired,
    canRecover: ready && recoveryRequired,
    canAcknowledgeInputError: ready && !!inputError && !recoveryRequired,
    selectWorkspace,
    selectSurface,
    sendText,
    submitText,
    sendKey,
    recoverInput,
    acknowledgeInputError,
    reconnect,
  };
}
