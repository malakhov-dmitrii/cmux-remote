export const PROTOCOL_VERSION = 1;
export const MAX_INPUT_LENGTH = 8_000;
export const MAX_REQUEST_LENGTH = 24_000;
export type Delivery = "not_sent" | "unknown" | "text_inserted";
export type ErrorCode =
  | "invalid_request"
  | "unsupported_version"
  | "busy"
  | "recovery_required"
  | "upstream_error"
  | "upstream_unavailable"
  | "invalid_response"
  | "connection_closed"
  | "storage_error";
export interface RpcError {
  code: ErrorCode;
  message: string;
  delivery: Delivery;
  detail?: string;
}
export class RemoteError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly delivery: Delivery = "not_sent",
    public readonly detail?: string,
  ) {
    super(message);
    this.name = "RemoteError";
  }
}
type Target = { workspace_ref: string; surface_ref: string };
export interface WorkspaceOptions {
  name?: string;
  cwd?: string;
}
export interface CreatedTarget {
  workspace_id: string;
  surface_id: string;
}
type Request<M extends string, P> = { version: 1; id: string; method: M; params: P };
export type RpcRequest =
  | Request<"workspace.list", Record<string, never>>
  | Request<"workspace.create", WorkspaceOptions>
  | Request<"surface.create", Target>
  | Request<"surface.list", { workspace_ref: string }>
  | Request<"surface.read_text", Target>
  | Request<"surface.send_text" | "surface.submit", Target & { text: string }>
  | Request<"surface.send_key", Target & { key: "enter" | "ctrl+c"; confirmRecovery?: true }>;
export type RpcMethod = RpcRequest["method"];
export type RpcResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: RpcError };
export interface Workspace {
  id: string;
  ref: string;
  title: string;
  index: number;
  selected?: boolean;
  current_directory?: string;
}
export interface Surface {
  id: string;
  ref: string;
  type: string;
  title: string;
  focused?: boolean;
  selected_in_pane?: boolean;
  pane_ref?: string;
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}
export function validateInputText(text: string): string | null {
  if (!text) return "Enter some text first.";
  if (text.length > MAX_INPUT_LENGTH) return `Use at most ${MAX_INPUT_LENGTH} characters.`;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Terminal input must reject control characters, including newline and escape.
  if (/[\x00-\x1f\x7f]/.test(text)) return "Send one line of text without control characters.";
  return null;
}
export const isValidInputText = (text: string) => validateInputText(text) === null;
export function normalizeWorkspaceOptions(value: Record<string, unknown>): WorkspaceOptions {
  const options: WorkspaceOptions = {};
  for (const [key, limit] of [
    ["name", 80],
    ["cwd", 4096],
  ] as const) {
    const raw = value[key];
    if (raw === undefined) continue;
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Creation fields must not carry terminal or path control bytes.
    if (typeof raw !== "string" || raw.length > limit || /[\x00-\x1f\x7f]/.test(raw))
      throw new RemoteError(
        "invalid_request",
        `${key === "name" ? "Name" : "Directory"} must be one line, up to ${limit} characters.`,
      );
    const text = raw.trim();
    if (text) options[key] = text;
  }
  return options;
}
export function parseCreatedTarget(value: unknown): CreatedTarget {
  if (!isRecord(value) || !isUuid(value.workspace_id) || !isUuid(value.surface_id))
    throw new RemoteError(
      "invalid_response",
      "Creation was not confirmed. Check sessions before trying again.",
      "unknown",
    );
  return { workspace_id: value.workspace_id, surface_id: value.surface_id };
}
function uuidParam(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (!isUuid(value))
    throw new RemoteError("invalid_request", `A stable UUID is required for ${key}.`);
  return value;
}
export function decodeRpcRequest(value: unknown): RpcRequest {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id || value.id.length > 80) {
    throw new RemoteError("invalid_request", "Invalid request ID.");
  }
  if (value.version !== PROTOCOL_VERSION)
    throw new RemoteError(
      "unsupported_version",
      "Reload this page to use the current remote protocol.",
    );
  if (typeof value.method !== "string")
    throw new RemoteError("invalid_request", "Invalid request method.");
  if (!isRecord(value.params))
    throw new RemoteError("invalid_request", "Invalid request parameters.");
  const base = { version: PROTOCOL_VERSION, id: value.id } as const;
  const params = value.params;
  if (value.method === "workspace.list") return { ...base, method: value.method, params: {} };
  if (value.method === "workspace.create")
    return { ...base, method: value.method, params: normalizeWorkspaceOptions(params) };
  if (value.method === "surface.list")
    return {
      ...base,
      method: value.method,
      params: { workspace_ref: uuidParam(params, "workspace_ref") },
    };
  if (
    ![
      "surface.read_text",
      "surface.send_text",
      "surface.send_key",
      "surface.submit",
      "surface.create",
    ].includes(value.method)
  ) {
    throw new RemoteError("invalid_request", "This method is not available in the remote.");
  }
  const target = {
    workspace_ref: uuidParam(params, "workspace_ref"),
    surface_ref: uuidParam(params, "surface_ref"),
  };
  if (value.method === "surface.create") return { ...base, method: value.method, params: target };
  if (value.method === "surface.read_text")
    return { ...base, method: value.method, params: target };
  if (value.method === "surface.send_text" || value.method === "surface.submit") {
    if (typeof params.text !== "string")
      throw new RemoteError("invalid_request", "Text is required.");
    const error = validateInputText(params.text);
    if (error) throw new RemoteError("invalid_request", error);
    return { ...base, method: value.method, params: { ...target, text: params.text } };
  }
  if (params.key !== "enter" && params.key !== "ctrl+c")
    throw new RemoteError("invalid_request", "Only Enter and Ctrl+C are available.");
  if (
    params.confirmRecovery !== undefined &&
    (params.confirmRecovery !== true || params.key !== "ctrl+c")
  ) {
    throw new RemoteError("invalid_request", "Recovery confirmation is only available for Ctrl+C.");
  }
  return {
    ...base,
    method: "surface.send_key",
    params: {
      ...target,
      key: params.key,
      ...(params.confirmRecovery === true ? { confirmRecovery: true } : {}),
    },
  };
}
let sequence = 0;
export function createRpcRequest(
  method: RpcMethod,
  params: Record<string, unknown> = {},
): RpcRequest {
  return decodeRpcRequest({ version: PROTOCOL_VERSION, id: String(++sequence), method, params });
}
const ERROR_CODES = new Set<unknown>([
  "invalid_request",
  "unsupported_version",
  "busy",
  "recovery_required",
  "upstream_error",
  "upstream_unavailable",
  "invalid_response",
  "connection_closed",
  "storage_error",
]);
// biome-ignore lint/suspicious/noPrototypeBuiltins: This borrowed method supports the client ES2020 target and ignores object-defined properties.
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
function isErrorCode(value: unknown): value is ErrorCode {
  return ERROR_CODES.has(value);
}
function isDelivery(value: unknown): value is Delivery {
  return value === "not_sent" || value === "unknown" || value === "text_inserted";
}
export function parseRpcResponse(data: string): RpcResponse {
  const value: unknown = JSON.parse(data);
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !value.id ||
    value.id.length > 80 ||
    typeof value.ok !== "boolean"
  ) {
    throw new RemoteError("invalid_response", "Invalid remote response.");
  }
  if (value.ok === true && own(value, "result") && !own(value, "error"))
    return { id: value.id, ok: true, result: value.result };
  if (value.ok === false && !own(value, "result") && isRecord(value.error)) {
    const error = value.error;
    if (
      isErrorCode(error.code) &&
      typeof error.message === "string" &&
      isDelivery(error.delivery) &&
      (error.detail === undefined || typeof error.detail === "string")
    ) {
      return {
        id: value.id,
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          delivery: error.delivery,
          ...(typeof error.detail === "string" ? { detail: error.detail } : {}),
        },
      };
    }
  }
  throw new RemoteError("invalid_response", "Invalid remote response.");
}
export function parseWorkspaces(value: unknown): Workspace[] {
  if (!isRecord(value) || !Array.isArray(value.workspaces))
    throw new RemoteError("invalid_response", "Invalid workspace list.");
  return value.workspaces.map((item: unknown) => {
    if (
      !isRecord(item) ||
      !isUuid(item.id) ||
      typeof item.ref !== "string" ||
      typeof item.title !== "string"
    ) {
      throw new RemoteError("invalid_response", "Invalid workspace.");
    }
    return {
      id: item.id,
      ref: item.ref,
      title: item.title,
      selected: item.selected === true,
      index: typeof item.index === "number" && Number.isFinite(item.index) ? item.index : 0,
      ...(typeof item.current_directory === "string"
        ? { current_directory: item.current_directory }
        : {}),
    };
  });
}
export function parseSurfaces(value: unknown): Surface[] {
  if (!isRecord(value) || !Array.isArray(value.surfaces))
    throw new RemoteError("invalid_response", "Invalid terminal list.");
  return value.surfaces.map((item: unknown) => {
    if (
      !isRecord(item) ||
      !isUuid(item.id) ||
      typeof item.ref !== "string" ||
      typeof item.type !== "string" ||
      typeof item.title !== "string"
    ) {
      throw new RemoteError("invalid_response", "Invalid terminal.");
    }
    return {
      id: item.id,
      ref: item.ref,
      type: item.type,
      title: item.title,
      focused: item.focused === true,
      selected_in_pane: item.selected_in_pane === true,
      ...(typeof item.pane_ref === "string" ? { pane_ref: item.pane_ref } : {}),
    };
  });
}
