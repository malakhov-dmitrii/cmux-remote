import {
  IconAdjustmentsHorizontal,
  IconArrowUp,
  IconClipboard,
  IconCornerDownLeft,
  IconLayoutSidebar,
  IconPlayerStop,
} from "@tabler/icons-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { validateInputText } from "../../shared/protocol";
import { CreateMenu, type CreationView } from "./components/CreateMenu";
import { Drawer } from "./components/Drawer";
import { Terminal } from "./components/Terminal";
import { useCmux } from "./hooks/useCmux";

export function App() {
  const remote = useCmux();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [creationView, setCreationView] = useState<CreationView>(null);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const closeControls = useCallback(() => setControlsOpen(false), []);
  const changeCreationView = useCallback((view: CreationView) => {
    setCreationView(view);
    if (view) setControlsOpen(false);
  }, []);
  const openDrawer = () => {
    setControlsOpen(false);
    setCreationView(null);
    if (window.innerWidth >= 768) {
      document.querySelector<HTMLInputElement>(".session-search input")?.focus();
      return;
    }
    setDrawerOpen(true);
  };
  const [viewportHeight, setViewportHeight] = useState(window.visualViewport?.height);
  const [viewportTop, setViewportTop] = useState(window.visualViewport?.offsetTop ?? 0);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const resize = () => {
      setViewportHeight(viewport.height);
      setViewportTop(viewport.offsetTop || 0);
    };
    viewport.addEventListener("resize", resize);
    viewport.addEventListener("scroll", resize);
    return () => {
      viewport.removeEventListener("resize", resize);
      viewport.removeEventListener("scroll", resize);
    };
  }, []);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ target: string; text: string } | null>(null);
  const [followRequest, setFollowRequest] = useState(0);
  const currentTarget = useRef(remote.targetKey);
  currentTarget.current = remote.targetKey;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const draft = drafts[remote.targetKey] ?? "";
  const draftError = draft ? validateInputText(draft) : null;
  const workspace = remote.workspaces.find((item) => item.id === remote.currentWorkspace);
  const terminals = remote.surfaces.filter((item) => item.type === "terminal");
  const canSend = remote.canInput && !!draft && !draftError;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Draft and target changes alter textarea geometry and require a new DOM measurement.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "0px";
    input.style.height = `${Math.max(44, Math.min(input.scrollHeight, 144))}px`;
  }, [draft, remote.targetKey]);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 2500);
    return () => clearTimeout(timer);
  }, [feedback]);

  const sendDraft = async (submit: boolean) => {
    if (!canSend) return;
    const target = remote.targetKey;
    const text = draft;
    const confirmed = await (submit ? remote.submitText(text) : remote.sendText(text));
    if (confirmed) {
      setDrafts((previous) =>
        previous[target] === text ? { ...previous, [target]: "" } : previous,
      );
      setFeedback({ target, text: submit ? "Sent" : "Text inserted" });
      if (target === currentTarget.current) setFollowRequest((value) => value + 1);
    }
  };
  const sendTerminalKey = (key: "enter" | "ctrl+c") => {
    if (!remote.canInput) return;
    setFollowRequest((value) => value + 1);
    void remote.sendKey(key);
  };
  const selectingSession =
    remote.loaded &&
    remote.workspaces.length > 0 &&
    !remote.currentWorkspace &&
    (!remote.readError || remote.readError.code === "invalid_request");
  const selectingTerminal =
    remote.loaded &&
    remote.surfacesLoaded &&
    !!remote.currentWorkspace &&
    !remote.currentSurface &&
    remote.readError?.code === "invalid_request";
  const emptyWorkspaces =
    remote.status === "connected" &&
    remote.loaded &&
    remote.workspaces.length === 0 &&
    !remote.readError;
  let stateMessage: string | null = null;
  if (remote.readError?.code === "unsupported_version") stateMessage = remote.readError.message;
  else if (remote.status !== "connected")
    stateMessage = "Disconnected from your Mac. Your draft stays here.";
  else if (remote.readError) stateMessage = remote.readError.message;
  else if (!remote.loaded) stateMessage = "Loading sessions…";
  else if (remote.workspaces.length === 0) stateMessage = "Create your first workspace.";
  else if (!remote.currentWorkspace) stateMessage = "Choose a session.";
  else if (!remote.surfacesLoaded) stateMessage = "Loading terminals…";
  else if (!remote.currentSurface && terminals.length === 0)
    stateMessage = "This session has no terminals.";
  else if (!remote.currentSurface) stateMessage = "Choose a terminal.";
  else if (!remote.fresh) stateMessage = "Refreshing output. Input will be available shortly.";
  const connection =
    remote.status !== "connected" ? "Disconnected" : remote.fresh ? "Connected" : "Refreshing";
  return (
    <div
      className={`app-shell ${viewportHeight !== undefined && viewportHeight < 540 ? "is-compact" : ""}`}
      style={{ height: viewportHeight, top: viewportTop }}
    >
      <Drawer
        open={drawerOpen}
        workspaces={remote.workspaces}
        currentWorkspace={remote.currentWorkspace}
        onSelect={remote.selectWorkspace}
        onClose={closeDrawer}
        loaded={remote.loaded}
      />
      <main className="remote-main" inert={drawerOpen}>
        <header className="header">
          <h1 aria-label={workspace?.title || "Sessions"}>
            <button
              type="button"
              className="session-switch"
              onClick={openDrawer}
              aria-label="Choose session"
              title={workspace?.title || "Sessions"}
            >
              <IconLayoutSidebar size={18} stroke={1.6} aria-hidden="true" />
              <span>{workspace?.title || "Sessions"}</span>
            </button>
          </h1>
          <span
            className={`connection ${remote.status === "connected" && remote.fresh ? "connected" : ""}`}
            role="status"
            aria-label={connection}
            title={
              remote.lastReadAt
                ? `Updated ${new Date(remote.lastReadAt).toLocaleTimeString("en", { hour12: false })}`
                : undefined
            }
          >
            <span className="connection-dot" aria-hidden="true" />
          </span>
          <CreateMenu
            creation={remote.creation}
            view={creationView}
            onViewChange={changeCreationView}
            onViewSessions={openDrawer}
          />
          <button
            type="button"
            className="icon-button"
            aria-label="Display"
            aria-controls="terminal-view-controls"
            aria-haspopup="dialog"
            aria-expanded={controlsOpen}
            onClick={() => {
              setCreationView(null);
              setControlsOpen((open) => !open);
            }}
          >
            <IconAdjustmentsHorizontal size={18} stroke={1.6} aria-hidden="true" />
          </button>
        </header>
        {terminals.length > 0 && (terminals.length > 1 || !remote.currentSurface) && (
          <fieldset className="surface-tabs" aria-label="Terminals">
            {terminals.map((item, index) => (
              <button
                type="button"
                key={item.id}
                aria-pressed={item.id === remote.currentSurface}
                onClick={() => {
                  setControlsOpen(false);
                  setCreationView(null);
                  remote.selectSurface(item.id);
                }}
                title={item.title}
              >
                <span className="surface-number">{index + 1}</span>
                <span className="surface-title">{item.title || "Terminal"}</span>
              </button>
            ))}
          </fieldset>
        )}
        {stateMessage && (
          <div className="notice" role="status">
            <span>{stateMessage}</span>
            {remote.readError?.code === "unsupported_version" ? (
              <button type="button" onClick={() => window.location.reload()}>
                Reload
              </button>
            ) : emptyWorkspaces ? (
              <button
                type="button"
                disabled={!remote.creation.canCreateWorkspace}
                onClick={() => changeCreationView("workspace")}
              >
                New workspace
              </button>
            ) : selectingSession ? (
              <button type="button" onClick={openDrawer}>
                Select
              </button>
            ) : (
              !selectingTerminal &&
              (remote.status !== "connected" || remote.readError) && (
                <button type="button" onClick={remote.reconnect}>
                  Retry
                </button>
              )
            )}
          </div>
        )}
        {remote.creation.error && !creationView && (
          <div className="notice" role="alert">
            <span>
              {remote.creation.error.delivery === "not_sent"
                ? remote.creation.error.message
                : "Creation was not confirmed. Check sessions before trying again."}
            </span>
            <button type="button" onClick={() => changeCreationView("menu")}>
              Review
            </button>
          </div>
        )}
        <Terminal
          key={remote.targetKey}
          content={remote.content}
          followRequest={followRequest}
          controlsOpen={controlsOpen}
          onControlsClose={closeControls}
        />
        <section className="composer" aria-label="Terminal input">
          {remote.inputError && (
            <div className="input-error" role="alert">
              <strong>
                {remote.inputError.delivery === "text_inserted"
                  ? "Text inserted; Enter was not confirmed."
                  : remote.recoveryRequired
                    ? "Input needs recovery."
                    : "Input was not sent."}
              </strong>
              <p>
                {remote.recoveryRequired
                  ? "Check the output. Recovery sends Ctrl+C and may interrupt the running command."
                  : remote.inputError.message}
              </p>
              <div className="error-actions">
                {remote.recoveryRequired ? (
                  <button
                    type="button"
                    disabled={!remote.canRecover}
                    onClick={() => {
                      void remote.recoverInput();
                    }}
                  >
                    Send Ctrl+C to recover
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!remote.canAcknowledgeInputError}
                    onClick={remote.acknowledgeInputError}
                  >
                    Dismiss
                  </button>
                )}
                <details>
                  <summary>Details</summary>
                  <p>{remote.inputError.message}</p>
                  {remote.inputError.detail && <p>{remote.inputError.detail}</p>}
                </details>
              </div>
            </div>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void sendDraft(true);
            }}
          >
            <div className="composer-field">
              <label htmlFor="draft" className="sr-only">
                Terminal text
              </label>
              <textarea
                ref={inputRef}
                id="draft"
                value={draft}
                rows={1}
                disabled={!remote.currentSurface}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="send"
                placeholder={remote.currentSurface ? "Message…" : "Choose a terminal"}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void sendDraft(true);
                  }
                }}
                onChange={(event) => {
                  setDrafts((previous) => ({
                    ...previous,
                    [remote.targetKey]: event.target.value,
                  }));
                  setFeedback(null);
                }}
              />
              <button
                type="submit"
                className="primary"
                aria-label="Send command"
                aria-busy={remote.sending}
                disabled={!canSend}
              >
                <IconArrowUp size={18} stroke={1.6} aria-hidden="true" />
              </button>
            </div>
            {draftError && (
              <p className="draft-error" role="alert">
                {draftError}
              </p>
            )}
            <div className="composer-actions">
              <button
                type="button"
                className="key-button"
                aria-label="Enter"
                disabled={!remote.canInput}
                onClick={() => sendTerminalKey("enter")}
              >
                <IconCornerDownLeft size={18} stroke={1.6} aria-hidden="true" />
                <span>Enter</span>
              </button>
              <button
                type="button"
                className="key-button interrupt"
                aria-label="Ctrl+C"
                disabled={!remote.canInput}
                onClick={() => sendTerminalKey("ctrl+c")}
              >
                <IconPlayerStop size={18} stroke={1.6} aria-hidden="true" />
                <span>Ctrl+C</span>
              </button>
              <button
                type="button"
                className="insert-button"
                aria-label="Insert"
                disabled={!canSend}
                onClick={() => {
                  void sendDraft(false);
                }}
                title="Insert text without Enter"
              >
                <IconClipboard size={18} stroke={1.6} aria-hidden="true" />
              </button>
              <span className="send-feedback" role="status">
                {feedback?.target === remote.targetKey ? feedback.text : ""}
              </span>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
