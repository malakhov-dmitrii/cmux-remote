// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Drawer } from "./Drawer";

afterEach(cleanup);
it("finds sessions by name or directory and selects the original ID", () => {
  const select = vi.fn();
  const close = vi.fn();
  render(
    <Drawer
      open
      workspaces={[
        {
          id: "alpha",
          ref: "workspace:1",
          title: "Server logs",
          index: 0,
          current_directory: "/Users/test/code/api",
        },
        {
          id: "beta",
          ref: "workspace:2",
          title: "Web preview",
          index: 1,
          current_directory: "/Users/test/code/frontend",
        },
      ]}
      currentWorkspace="alpha"
      onSelect={select}
      onClose={close}
    />,
  );
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "frontend" } });
  expect(screen.queryByText("Server logs")).toBe(null);
  fireEvent.click(screen.getByRole("button", { name: "Web preview ~/code/frontend" }));
  expect(select).toHaveBeenCalledWith("beta");
  expect(close).toHaveBeenCalledOnce();
});
