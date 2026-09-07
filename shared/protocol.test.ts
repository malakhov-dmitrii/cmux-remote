import { describe, expect, it } from "bun:test";
import {
  createRpcRequest,
  decodeRpcRequest,
  isValidInputText,
  MAX_INPUT_LENGTH,
  parseRpcResponse,
  parseSurfaces,
  parseWorkspaces,
} from "./protocol";

const workspace = "11111111-1111-1111-1111-111111111111";
const surface = "22222222-2222-2222-2222-222222222222";
const target = { workspace_ref: workspace, surface_ref: surface };
describe("shared remote protocol", () => {
  it("constructs versioned requests and discards unrelated parameters", () => {
    expect(
      createRpcRequest("surface.submit", { ...target, text: "echo hello", secret: "discard" }),
    ).toMatchObject({
      version: 1,
      method: "surface.submit",
      params: { ...target, text: "echo hello" },
    });
    expect(Object.keys(createRpcRequest("workspace.list", { unsafe: true }).params)).toEqual([]);
  });
  it("rejects legacy, malformed methods, unstable targets and unsupported keys before dispatch", () => {
    const good = {
      version: 1,
      id: "1",
      method: "surface.send_key",
      params: { ...target, key: "enter" },
    };
    for (const request of [
      { ...good, version: undefined },
      { ...good, version: 2 },
      { ...good, id: "" },
      { ...good, method: ["surface.submit"] },
      { ...good, method: "pane.list" },
      { ...good, params: { ...target, surface_ref: "surface:1", key: "enter" } },
      { ...good, params: { ...target, key: "ctrl+d" } },
      { ...good, params: { ...target, key: "enter", confirmRecovery: true } },
    ]) {
      expect(() => decodeRpcRequest(request)).toThrow();
    }
  });
  it("allows explicit Ctrl+C recovery and bounds literal single-line text", () => {
    expect(
      createRpcRequest("surface.send_key", { ...target, key: "ctrl+c", confirmRecovery: true })
        .params,
    ).toEqual({ ...target, key: "ctrl+c", confirmRecovery: true });
    expect(isValidInputText("x".repeat(MAX_INPUT_LENGTH))).toBe(true);
    expect(isValidInputText("café $(literal) `text`; 🐢")).toBe(true);
    for (const text of [
      "",
      "x".repeat(MAX_INPUT_LENGTH + 1),
      "a\nb",
      "\r",
      "\t",
      "\0",
      "\x1b",
      "\x7f",
    ])
      expect(isValidInputText(text)).toBe(false);
  });
  it("rejects missing or contradictory response fields and untyped errors", () => {
    for (const value of [
      null,
      [],
      { id: "1" },
      { id: "1", ok: true },
      { id: "1", ok: false },
      { id: "1", ok: true, result: {}, error: {} },
      {
        id: "1",
        ok: false,
        result: {},
        error: { code: "busy", message: "Busy", delivery: "not_sent" },
      },
      { id: "1", ok: false, error: { code: "invented", message: "Bad", delivery: "unknown" } },
      { id: "1", ok: false, error: { code: "busy", message: "Busy" } },
    ])
      expect(() => parseRpcResponse(JSON.stringify(value))).toThrow();
    expect(parseRpcResponse('{"id":"1","ok":true,"result":null}')).toEqual({
      id: "1",
      ok: true,
      result: null,
    });
    expect(
      parseRpcResponse(
        '{"id":"2","ok":false,"error":{"code":"upstream_error","message":"Failed","delivery":"text_inserted","detail":"native diagnostic"}}',
      ),
    ).toMatchObject({ error: { delivery: "text_inserted", detail: "native diagnostic" } });
  });
  it("parses only well-formed workspace and terminal lists", () => {
    expect(
      parseWorkspaces({ workspaces: [{ id: workspace, ref: "workspace:1", title: "Test" }] }),
    ).toHaveLength(1);
    expect(
      parseSurfaces({
        surfaces: [{ id: surface, ref: "surface:1", title: "Shell", type: "terminal" }],
      }),
    ).toHaveLength(1);
    for (const value of [
      null,
      {},
      [],
      { workspaces: [{ id: "alias", ref: "workspace:1", title: "Test" }] },
    ])
      expect(() => parseWorkspaces(value)).toThrow();
    expect(() =>
      parseSurfaces({ surfaces: [{ id: surface, ref: "surface:1", type: "terminal" }] }),
    ).toThrow();
  });
});
