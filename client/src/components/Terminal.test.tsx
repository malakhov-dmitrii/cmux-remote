// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Terminal } from "./Terminal";

afterEach(cleanup);
describe("terminal snapshots", () => {
  it("clears the old screen when the new snapshot is empty", () => {
    const view = render(<Terminal content="old output" />);
    expect(screen.getByLabelText("Terminal output").textContent).toContain("old output");
    view.rerender(<Terminal content="" />);
    expect(screen.getByLabelText("Terminal output").textContent).toBe("");
  });
  it("keeps the scroll position while the user reads earlier output", () => {
    const view = render(<Terminal content="first snapshot" />);
    const viewer = screen.getByLabelText("Terminal output");
    Object.defineProperties(viewer, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 300 },
    });
    viewer.scrollTop = 120;
    fireEvent.scroll(viewer);
    view.rerender(<Terminal content="updated snapshot" />);
    expect(viewer.scrollTop).toBe(120);
    expect(viewer.textContent).toBe("first snapshot");
    fireEvent.click(screen.getByRole("button", { name: "Latest output" }));
    expect(viewer.scrollTop).toBe(1000);
    expect(viewer.textContent).toBe("updated snapshot");
  });
  it("keeps original terminal formatting accessible while text mode removes frame padding", () => {
    const original = "┌─────────────┐\n│ hello       │\n└─────────────┘\n└── src/file.ts";
    render(<Terminal content={original} controlsOpen />);
    expect(screen.getByLabelText("Terminal output").textContent).toContain("hello");
    expect(screen.getByLabelText("Terminal output").textContent).toContain("└── src/file.ts");
    expect(screen.getByLabelText("Terminal output").textContent).not.toContain("│ hello       │");
    fireEvent.click(screen.getByRole("button", { name: "Original" }));
    expect(screen.getByLabelText("Terminal output").textContent).toBe(original);
  });
  it("keeps reading controls hidden until requested and closes them with Escape", () => {
    const close = vi.fn();
    const view = render(<Terminal content="prompt" onControlsClose={close} />);
    expect(screen.queryByRole("button", { name: "Original" })).toBe(null);
    view.rerender(<Terminal content="prompt" controlsOpen onControlsClose={close} />);
    expect(screen.getByRole("dialog", { name: "Display" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Increase text size" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
  });
});
