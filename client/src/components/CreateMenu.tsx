import { IconFolder, IconPlus, IconTerminal2, IconX } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { normalizeWorkspaceOptions, type WorkspaceOptions } from "../../../shared/protocol";
import type { CreationState } from "../hooks/useCreation";
import "./CreateMenu.css";

export type CreationView = "menu" | "workspace" | null;
interface CreateMenuProps {
  creation: CreationState;
  view: CreationView;
  onViewChange: (view: CreationView) => void;
  onViewSessions: () => void;
}

export function CreateMenu({ creation, view, onViewChange, onViewSessions }: CreateMenuProps) {
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(true);
  const [name, setName] = useState("");
  const [directory, setDirectory] = useState("");
  useEffect(() => {
    if (!view) return;
    restoreFocus.current = true;
    const first = popup.current?.querySelector<HTMLElement>(
      view === "workspace" ? "input" : "button",
    );
    first?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onViewChange(null);
      }
      if (event.key !== "Tab" || view !== "workspace") return;
      const controls = popup.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), summary",
      );
      const firstControl = controls?.[0];
      const lastControl = controls?.[controls.length - 1];
      if (event.shiftKey && document.activeElement === firstControl) {
        event.preventDefault();
        lastControl?.focus();
      } else if (!event.shiftKey && document.activeElement === lastControl) {
        event.preventDefault();
        firstControl?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (view !== "menu" || !(event.target instanceof Node)) return;
      if (popup.current?.contains(event.target) || trigger.current?.contains(event.target)) return;
      restoreFocus.current = false;
      onViewChange(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      if (restoreFocus.current) trigger.current?.focus();
    };
  }, [view, onViewChange]);

  let options: WorkspaceOptions = {};
  let validation: string | null = null;
  try {
    options = normalizeWorkspaceOptions({ name, cwd: directory });
  } catch (error) {
    validation = error instanceof Error ? error.message : "Check the name and directory.";
  }
  const uncertain = !!creation.error && creation.error.delivery !== "not_sent";
  const submitWorkspace = async () => {
    if (validation || !creation.canCreateWorkspace) return;
    if (await creation.createWorkspace(options)) {
      setName("");
      setDirectory("");
      onViewChange(null);
    }
  };
  const createTerminal = async () => {
    if (await creation.createTerminal()) onViewChange(null);
  };

  return (
    <div className="creation-control">
      <button
        ref={trigger}
        type="button"
        className="icon-button"
        aria-label="Create"
        aria-haspopup="dialog"
        aria-controls="creation-controls"
        aria-expanded={view !== null}
        aria-busy={creation.busy}
        onClick={() => onViewChange(view ? null : "menu")}
      >
        <IconPlus size={18} stroke={1.6} aria-hidden="true" />
      </button>
      {view === "workspace" && (
        <button
          type="button"
          className="creation-backdrop"
          aria-label={creation.busy ? "Close creation dialog" : "Cancel creation"}
          onClick={() => onViewChange(null)}
        />
      )}
      {view && (
        <div
          ref={popup}
          className="creation-popover"
          id="creation-controls"
          role="dialog"
          aria-label={view === "workspace" ? "New workspace" : "Create"}
          aria-modal={view === "workspace" ? true : undefined}
        >
          <div className="creation-heading">
            <span>{view === "workspace" ? "New workspace" : "Create"}</span>
            <button
              type="button"
              className="icon-button"
              aria-label="Close creation"
              onClick={() => onViewChange(null)}
            >
              <IconX size={18} stroke={1.6} aria-hidden="true" />
            </button>
          </div>
          {creation.busy && (
            <p className="creation-status" role="status">
              Creating…
            </p>
          )}
          {creation.error && (
            <div className="creation-error" role="alert">
              <strong>{uncertain ? "Creation was not confirmed." : "Could not create."}</strong>
              <p>
                {uncertain
                  ? "It may already exist. Check sessions before trying again."
                  : creation.error.message}
              </p>
              <div className="creation-error-actions">
                {uncertain && (
                  <button
                    type="button"
                    onClick={() => {
                      restoreFocus.current = false;
                      onViewChange(null);
                      onViewSessions();
                    }}
                  >
                    View sessions
                  </button>
                )}
                <button type="button" disabled={creation.busy} onClick={creation.acknowledgeError}>
                  {uncertain ? "I checked sessions" : "Dismiss"}
                </button>
              </div>
              <details>
                <summary>Details</summary>
                <p>{creation.error.message}</p>
                {creation.error.detail && <p>{creation.error.detail}</p>}
              </details>
            </div>
          )}
          {view === "workspace" ? (
            <form
              className="creation-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submitWorkspace();
              }}
            >
              <label htmlFor="workspace-name">Name</label>
              <input
                id="workspace-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Optional"
                maxLength={80}
                disabled={creation.busy}
                autoComplete="off"
              />
              <label htmlFor="workspace-directory">Directory</label>
              <input
                id="workspace-directory"
                value={directory}
                onChange={(event) => setDirectory(event.target.value)}
                placeholder="~"
                maxLength={4096}
                disabled={creation.busy}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              <p className="creation-hint">Absolute path or ~/…</p>
              {validation && (
                <p className="creation-validation" role="alert">
                  {validation}
                </p>
              )}
              <div className="creation-form-actions">
                <button type="button" onClick={() => onViewChange(null)}>
                  {creation.busy ? "Close" : "Cancel"}
                </button>
                <button
                  type="submit"
                  className="creation-confirm"
                  aria-label="Create workspace"
                  disabled={!creation.canCreateWorkspace || !!validation}
                >
                  Create
                </button>
              </div>
            </form>
          ) : (
            <div className="creation-actions">
              <button
                type="button"
                className="creation-menu-action"
                disabled={!creation.canCreateWorkspace}
                onClick={() => onViewChange("workspace")}
              >
                <IconFolder size={18} stroke={1.6} aria-hidden="true" />
                New workspace
              </button>
              <button
                type="button"
                className="creation-menu-action"
                disabled={!creation.canCreateTerminal}
                onClick={() => {
                  void createTerminal();
                }}
              >
                <IconTerminal2 size={18} stroke={1.6} aria-hidden="true" />
                New terminal
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
