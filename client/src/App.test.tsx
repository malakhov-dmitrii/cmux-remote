// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RpcError } from "../../shared/protocol";
import { App } from "./App";

const mocked = vi.hoisted(() => ({
  current: {
    status: "connected",
    workspaces: [{ id: "a", ref: "workspace:1", title: "Alpha", index: 0 }],
    surfaces: [{ id: "s1", ref: "surface:1", title: "Shell", type: "terminal" }],
    currentWorkspace: "a",
    currentSurface: "s1",
    targetKey: "a/s1",
    content: "prompt",
    loaded: true,
    surfacesLoaded: true,
    fresh: true,
    canInput: true,
    sending: false,
    readError: ((): RpcError | null => null)(),
    inputError: ((): RpcError | null => null)(),
    recoveryRequired: false,
    canRecover: false,
    canAcknowledgeInputError: false,
    lastReadAt: 1000,
    selectWorkspace: vi.fn(),
    selectSurface: vi.fn(),
    sendText: vi.fn(),
    submitText: vi.fn(),
    sendKey: vi.fn(),
    recoverInput: vi.fn(),
    acknowledgeInputError: vi.fn(),
    reconnect: vi.fn(),
    creation: {
      busy: false,
      error: ((): RpcError | null => null)(),
      canCreateWorkspace: true,
      canCreateTerminal: true,
      createWorkspace: vi.fn(async () => true),
      createTerminal: vi.fn(async () => true),
      acknowledgeError: vi.fn(),
    },
  },
}));
vi.mock("./hooks/useCmux", () => ({ useCmux: () => mocked.current }));
vi.mock("./components/Terminal", () => ({
  Terminal: ({ content }: { content: string }) => <pre>{content}</pre>,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("innerWidth", 390);
  mocked.current.targetKey = "a/s1";
  mocked.current.currentSurface = "s1";
  mocked.current.currentWorkspace = "a";
  mocked.current.readError = null;
  mocked.current.inputError = null;
  mocked.current.recoveryRequired = false;
  mocked.current.canRecover = false;
  mocked.current.canAcknowledgeInputError = false;
  mocked.current.canInput = true;
  mocked.current.creation.busy = false;
  mocked.current.creation.error = null;
  mocked.current.creation.canCreateWorkspace = true;
  mocked.current.creation.canCreateTerminal = true;
  mocked.current.status = "connected";
  mocked.current.loaded = true;
  mocked.current.fresh = true;
  mocked.current.workspaces = [{ id: "a", ref: "workspace:1", title: "Alpha", index: 0 }];
  mocked.current.surfacesLoaded = true;
  mocked.current.surfaces = [{ id: "s1", ref: "surface:1", title: "Shell", type: "terminal" }];
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("remote composer", () => {
  it("opens creation from an empty workspace list", () => {
    mocked.current.workspaces = [];
    mocked.current.currentWorkspace = "";
    mocked.current.currentSurface = "";
    mocked.current.surfaces = [];
    mocked.current.creation.canCreateTerminal = false;
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "New workspace" }));
    expect(screen.getByRole("dialog", { name: "New workspace" })).toBeTruthy();
    expect(screen.getByLabelText("Name")).toBeTruthy();
  });
  it("preserves the terminal draft while opening and cancelling creation", () => {
    render(<App />);
    const editor = screen.getByLabelText<HTMLTextAreaElement>("Terminal text");
    fireEvent.change(editor, { target: { value: "keep this draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    fireEvent.click(screen.getByRole("button", { name: "New workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(editor.value).toBe("keep this draft");
  });
  it.each(["workspace", "surface"])("shows an initial %s list failure with Retry", (stage) => {
    mocked.current.loaded = stage === "surface";
    mocked.current.workspaces = stage === "surface" ? mocked.current.workspaces : [];
    mocked.current.currentWorkspace = stage === "surface" ? "a" : "";
    mocked.current.currentSurface = "";
    mocked.current.surfaces = [];
    mocked.current.surfacesLoaded = false;
    mocked.current.fresh = false;
    mocked.current.canInput = false;
    mocked.current.readError = {
      code: "upstream_unavailable",
      message: `Cannot read the ${stage} list.`,
      delivery: "not_sent",
    };
    render(<App />);
    const main = within(screen.getByRole("main"));
    expect(screen.getByText(`Cannot read the ${stage} list.`)).toBeTruthy();
    expect(main.queryByText("Loading sessions…")).toBe(null);
    expect(main.queryByText("Loading terminals…")).toBe(null);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Send command" }).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocked.current.reconnect).toHaveBeenCalledOnce();
  });
  it.each([false, true])("prioritizes protocol Reload with workspace list loaded=%s", (loaded) => {
    mocked.current.loaded = loaded;
    mocked.current.currentWorkspace = "";
    mocked.current.currentSurface = "";
    mocked.current.surfacesLoaded = false;
    mocked.current.readError = {
      code: "unsupported_version",
      message: "Reload this page to use the current remote protocol.",
      delivery: "not_sent",
    };
    render(<App />);
    expect(screen.getByText("Reload this page to use the current remote protocol.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBe(null);
    expect(screen.queryByRole("button", { name: "Select" })).toBe(null);
    expect(within(screen.getByRole("main")).queryByText("Loading sessions…")).toBe(null);
  });
  it("lets the user select the sole remaining terminal after the previous one closes", () => {
    mocked.current.currentSurface = "";
    mocked.current.canInput = false;
    mocked.current.readError = {
      code: "invalid_request",
      message: "This terminal closed. Choose another.",
      delivery: "not_sent",
    };
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "1 Shell" }));
    expect(mocked.current.selectSurface).toHaveBeenCalledWith("s1");
  });
  it("focuses the persistent desktop session search without opening a modal", () => {
    vi.stubGlobal("innerWidth", 1024);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Choose session" }));
    expect(screen.queryByRole("dialog", { name: "Sessions" })).toBe(null);
    expect(document.activeElement).toBe(screen.getByRole("searchbox", { name: "Find a session" }));
  });
  it("keeps a single terminal free of tab chrome and opens view controls from the header", () => {
    const view = render(<App />);
    expect(screen.queryByRole("group", { name: "Terminals" })).toBe(null);
    const settings = screen.getByRole("button", { name: "Display" });
    expect(settings.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(settings);
    expect(settings.getAttribute("aria-expanded")).toBe("true");
    mocked.current.surfaces = [
      ...mocked.current.surfaces,
      { id: "s2", ref: "surface:2", title: "Logs", type: "terminal" },
    ];
    view.rerender(<App />);
    expect(screen.getByRole("group", { name: "Terminals" })).toBeTruthy();
  });
  it("offers selection rather than reconnect when the selected workspace closes", () => {
    mocked.current.currentWorkspace = "";
    mocked.current.readError = {
      code: "invalid_request",
      message: "This session closed. Choose another.",
      delivery: "not_sent",
    };
    render(<App />);
    expect(screen.getByText("This session closed. Choose another.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBe(null);
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(screen.getByRole("dialog", { name: "Sessions" })).toBeTruthy();
  });
  it("compacts from the visual viewport even when the layout viewport stays tall", () => {
    const viewport = new EventTarget();
    Object.defineProperty(viewport, "height", { configurable: true, value: 350 });
    Object.defineProperty(viewport, "offsetTop", { configurable: true, value: 40 });
    vi.stubGlobal("visualViewport", viewport);
    const view = render(<App />);
    expect(view.container.firstElementChild?.classList.contains("is-compact")).toBe(true);
    expect(view.container.firstElementChild?.getAttribute("style")).toContain("350px");
    expect(view.container.firstElementChild?.getAttribute("style")).toContain("top: 40px");
    act(() => {
      Object.defineProperty(viewport, "height", { configurable: true, value: 844 });
      viewport.dispatchEvent(new Event("resize"));
    });
    expect(view.container.firstElementChild?.classList.contains("is-compact")).toBe(false);
  });
  it("submits a command through one target-pinned action", async () => {
    mocked.current.submitText.mockResolvedValue(true);
    render(<App />);
    fireEvent.change(screen.getByLabelText("Terminal text"), { target: { value: "hello" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send command" }));
    });
    expect(mocked.current.submitText).toHaveBeenCalledWith("hello");
    expect(mocked.current.sendText).not.toHaveBeenCalled();
    expect(screen.getByLabelText<HTMLTextAreaElement>("Terminal text").value).toBe("");
  });
  it("retains an unconfirmed draft and does not attach Enter to insert-only", async () => {
    mocked.current.sendText.mockResolvedValue(false);
    render(<App />);
    fireEvent.change(screen.getByLabelText("Terminal text"), { target: { value: "keep this" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    });
    expect(mocked.current.sendText).toHaveBeenCalledWith("keep this");
    expect(mocked.current.sendKey).not.toHaveBeenCalled();
    expect(screen.getByLabelText<HTMLTextAreaElement>("Terminal text").value).toBe("keep this");
  });

  it("clears only the acknowledged target draft, preserving a different terminal draft", async () => {
    let resolve: (value: boolean) => void = () => {};
    mocked.current.sendText.mockImplementation(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    );
    const view = render(<App />);
    fireEvent.change(screen.getByLabelText("Terminal text"), { target: { value: "alpha draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    mocked.current.targetKey = "a/s2";
    mocked.current.currentSurface = "s2";
    view.rerender(<App />);
    fireEvent.change(screen.getByLabelText("Terminal text"), { target: { value: "other draft" } });
    await act(async () => {
      resolve(true);
    });
    expect(screen.getByLabelText<HTMLTextAreaElement>("Terminal text").value).toBe("other draft");
    mocked.current.targetKey = "a/s1";
    mocked.current.currentSurface = "s1";
    view.rerender(<App />);
    expect(screen.getByLabelText<HTMLTextAreaElement>("Terminal text").value).toBe("");
  });

  it("disables all mutation controls until the selected terminal is fresh", () => {
    mocked.current.canInput = false;
    render(<App />);
    for (const name of ["Send command", "Insert", "Enter", "Ctrl+C"]) {
      expect(screen.getByRole<HTMLButtonElement>("button", { name }).disabled).toBe(true);
    }
  });

  it("prevents pasted newlines from being sent as terminal keystrokes", () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText("Terminal text"), { target: { value: "one\ntwo" } });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Send command" }).disabled).toBe(
      true,
    );
    expect(screen.getByRole("alert").textContent).toContain("one line");
    expect(mocked.current.sendText).not.toHaveBeenCalled();
  });

  it("shows loading until an empty terminal list is confirmed", () => {
    mocked.current.currentSurface = "";
    mocked.current.surfaces = [];
    mocked.current.surfacesLoaded = false;
    const view = render(<App />);
    expect(screen.queryByText("This session has no terminals.")).toBe(null);
    expect(screen.getByText("Loading terminals…")).toBeTruthy();
    mocked.current.surfacesLoaded = true;
    view.rerender(<App />);
    expect(screen.getByText("This session has no terminals.")).toBeTruthy();
    expect(screen.queryByText("Loading terminals…")).toBe(null);
  });
  it("keeps draft editing available while sending is disconnected", () => {
    mocked.current.canInput = false;
    render(<App />);
    const editor = screen.getByLabelText<HTMLTextAreaElement>("Terminal text");
    expect(editor.disabled).toBe(false);
    fireEvent.change(editor, { target: { value: "prepare offline" } });
    expect(editor.value).toBe("prepare offline");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Send command" }).disabled).toBe(
      true,
    );
  });
  it("offers explicit interruption for typed partial delivery while other input stays blocked", () => {
    mocked.current.inputError = {
      code: "upstream_error",
      message: "Diagnostic wording is irrelevant.",
      delivery: "text_inserted",
    };
    mocked.current.canInput = false;
    mocked.current.recoveryRequired = true;
    mocked.current.canRecover = true;
    render(<App />);
    expect(screen.getByText("Text inserted; Enter was not confirmed.")).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Send command" }).disabled).toBe(
      true,
    );
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBe(null);
    expect(mocked.current.recoverInput).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send Ctrl+C to recover" }));
    expect(mocked.current.recoverInput).toHaveBeenCalledOnce();
    expect(mocked.current.sendKey).not.toHaveBeenCalled();
  });
  it("does not infer delivery from error wording", () => {
    mocked.current.inputError = {
      code: "busy",
      message: "Text inserted appears only in a diagnostic quote.",
      delivery: "not_sent",
    };
    mocked.current.canInput = false;
    mocked.current.canAcknowledgeInputError = true;
    render(<App />);
    expect(screen.getByText("Input was not sent.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send Ctrl+C to recover" })).toBe(null);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(mocked.current.acknowledgeInputError).toHaveBeenCalledOnce();
  });
});
