// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreationState } from "../hooks/useCreation";
import { CreateMenu, type CreationView } from "./CreateMenu";

function model(overrides: Partial<CreationState> = {}): CreationState {
  return {
    busy: false,
    error: null,
    canCreateWorkspace: true,
    canCreateTerminal: true,
    createWorkspace: vi.fn(async () => true),
    createTerminal: vi.fn(async () => true),
    acknowledgeError: vi.fn(),
    ...overrides,
  };
}
function Menu({
  creation,
  onViewSessions = () => {},
}: {
  creation: CreationState;
  onViewSessions?: () => void;
}) {
  const [view, setView] = useState<CreationView>(null);
  return (
    <CreateMenu
      creation={creation}
      view={view}
      onViewChange={setView}
      onViewSessions={onViewSessions}
    />
  );
}
afterEach(cleanup);
describe("creation menu", () => {
  it("opens the workspace form and submits only its normalized name and directory", async () => {
    const creation = model();
    render(<Menu creation={creation} />);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    fireEvent.click(screen.getByRole("button", { name: "New workspace" }));
    const form = within(screen.getByRole("dialog", { name: "New workspace" }));
    fireEvent.change(form.getByLabelText("Name"), { target: { value: " Notes " } });
    fireEvent.change(form.getByLabelText("Directory"), { target: { value: " ~/code " } });
    await act(async () => {
      fireEvent.click(form.getByRole("button", { name: "Create workspace" }));
    });
    expect(creation.createWorkspace).toHaveBeenCalledWith({ name: "Notes", cwd: "~/code" });
    expect(screen.queryByRole("dialog")).toBe(null);
  });

  it("creates a terminal with one explicit action and disables it without an anchor", async () => {
    const creation = model();
    const view = render(<Menu creation={creation} />);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
    });
    expect(creation.createTerminal).toHaveBeenCalledOnce();
    view.rerender(<Menu creation={model({ canCreateTerminal: false })} />);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "New terminal" }).disabled).toBe(
      true,
    );
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "New workspace" }).disabled).toBe(
      false,
    );
  });

  it("requires checking sessions after an unknown result without offering terminal-input recovery", () => {
    const creation = model({
      error: { code: "upstream_unavailable", message: "No reply.", delivery: "unknown" },
      canCreateWorkspace: false,
      canCreateTerminal: false,
    });
    render(<Menu creation={creation} />);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(screen.getByText("Creation was not confirmed.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Ctrl\+C/ })).toBe(null);
    expect(creation.acknowledgeError).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "I checked sessions" }));
    expect(creation.acknowledgeError).toHaveBeenCalledOnce();
    expect(creation.createWorkspace).not.toHaveBeenCalled();
    expect(creation.createTerminal).not.toHaveBeenCalled();
  });

  it("closes with Escape and returns focus to the creation button", () => {
    render(<Menu creation={model()} />);
    const trigger = screen.getByRole("button", { name: "Create" });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBe(null);
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps keyboard focus inside the workspace form and restores the plus button", () => {
    render(<Menu creation={model()} />);
    const trigger = screen.getByRole("button", { name: "Create" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "New workspace" }));
    const dialog = screen.getByRole("dialog", { name: "New workspace" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(within(dialog).getByLabelText("Name"));
    const first = within(dialog).getByRole("button", { name: "Close creation" });
    const last = within(dialog).getByRole("button", { name: "Create workspace" });
    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBe(null);
    expect(document.activeElement).toBe(trigger);
  });

  it("labels busy dismissal as Close because creation continues after dismissal", () => {
    const view = render(<Menu creation={model()} />);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    fireEvent.click(screen.getByRole("button", { name: "New workspace" }));
    view.rerender(
      <Menu
        creation={model({ busy: true, canCreateWorkspace: false, canCreateTerminal: false })}
      />,
    );
    expect(screen.queryByRole("button", { name: "Cancel" })).toBe(null);
    expect(screen.getByRole("button", { name: "Close creation dialog" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBe(null);
    expect(screen.getByRole("button", { name: "Create" }).getAttribute("aria-busy")).toBe("true");
  });
});
