import { IconCheck, IconFolder, IconSearch, IconX } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import type { Workspace } from "../../../shared/protocol";

interface DrawerProps {
  open: boolean;
  workspaces: Workspace[];
  currentWorkspace: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  loaded?: boolean;
}
function shortPath(path: string) {
  return path.replace(/^\/Users\/[^/]+(?=\/|$)/, "~");
}
export function Drawer({
  open,
  workspaces,
  currentWorkspace,
  onSelect,
  onClose,
  loaded = true,
}: DrawerProps) {
  const drawerRef = useRef<HTMLElement>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    setQuery("");
    drawerRef.current?.querySelector<HTMLButtonElement>(".drawer-close")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const controls = drawerRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input",
      );
      const first = controls?.[0];
      const last = controls?.[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [open, onClose]);
  const search = query.trim().toLocaleLowerCase();
  const results = workspaces.filter((workspace) =>
    `${workspace.title} ${workspace.current_directory ?? ""}`.toLocaleLowerCase().includes(search),
  );
  const content = (
    <>
      <div className="drawer-heading">
        <h2>
          Sessions <span>{workspaces.length}</span>
        </h2>
        <button
          type="button"
          className="drawer-close icon-button"
          onClick={onClose}
          aria-label="Close"
        >
          <IconX size={18} stroke={1.6} aria-hidden="true" />
        </button>
      </div>
      <div className="session-search">
        <IconSearch size={18} stroke={1.6} aria-hidden="true" />
        <input
          aria-label="Find a session"
          placeholder="Search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          type="search"
          autoComplete="off"
        />
      </div>
      <ul>
        {results.map((workspace) => (
          <li key={workspace.id}>
            <button
              type="button"
              className={workspace.id === currentWorkspace ? "workspace active" : "workspace"}
              aria-current={workspace.id === currentWorkspace ? "true" : undefined}
              onClick={() => {
                onSelect(workspace.id);
                onClose();
              }}
            >
              <IconFolder size={18} stroke={1.6} className="workspace-icon" aria-hidden="true" />
              <span className="workspace-info">
                <span className="workspace-name">{workspace.title || "Untitled"}</span>
                {workspace.current_directory && (
                  <small title={workspace.current_directory}>
                    {shortPath(workspace.current_directory)}
                  </small>
                )}
              </span>
              {workspace.id === currentWorkspace && (
                <span className="selected-marker" aria-hidden="true">
                  <IconCheck size={18} stroke={1.6} aria-hidden="true" />
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {!results.length && (
        <div className="drawer-empty">
          {!loaded ? "Loading sessions…" : search ? "No sessions found" : "No cmux sessions yet"}
        </div>
      )}
    </>
  );
  return open ? (
    <>
      <button
        type="button"
        className="drawer-backdrop"
        aria-label="Close session list"
        onClick={onClose}
      />
      <section
        ref={drawerRef}
        className="drawer is-open"
        role="dialog"
        aria-modal="true"
        aria-label="Sessions"
      >
        {content}
      </section>
    </>
  ) : (
    <nav ref={drawerRef} className="drawer" aria-label="Sessions">
      {content}
    </nav>
  );
}
