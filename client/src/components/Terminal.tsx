import { IconArrowDown, IconMinus, IconPlus, IconX } from "@tabler/icons-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

function savedSize() {
  try {
    const size = Number(localStorage.getItem("cmux.remote.fontSize"));
    return size >= 6 && size <= 20 ? size : 14;
  } catch {
    return 14;
  }
}
function savedWrap() {
  try {
    return localStorage.getItem("cmux.remote.wrap") !== "false";
  } catch {
    return true;
  }
}
function readingText(content: string) {
  return content
    .split("\n")
    .map((line) => {
      if (/^\s*[\u2500-\u257f]+\s*$/.test(line)) return "";
      const framed = line.match(/^(\s*)[│┃] ?(.*?) ?[│┃]\s*$/);
      if (framed) return (framed[1] ?? "") + (framed[2] ?? "").trimEnd();
      if (/^\s*[╭╰┌└]/.test(line) && /[╮╯┐┘]\s*$/.test(line)) {
        return line.replace(/^[\s\u2500-\u257f]+/, "").replace(/[\s\u2500-\u257f]+$/, "");
      }
      return line.trimEnd();
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}
export function Terminal({
  content,
  followRequest = 0,
  controlsOpen = false,
  onControlsClose,
}: {
  content: string;
  followRequest?: number;
  controlsOpen?: boolean;
  onControlsClose?: () => void;
}) {
  const viewerRef = useRef<HTMLElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  const [displayContent, setDisplayContent] = useState(content);
  const latestContent = useRef(content);
  latestContent.current = content;
  const [fontSize, setFontSize] = useState(savedSize);
  const [wrap, setWrap] = useState(savedWrap);
  useEffect(() => {
    if (!controlsOpen) return;
    const previous = document.activeElement;
    controlsRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onControlsClose?.();
    };
    const onPointer = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (
        !controlsRef.current?.contains(event.target) &&
        !event.target.closest('[aria-controls="terminal-view-controls"]')
      )
        onControlsClose?.();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [controlsOpen, onControlsClose]);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (following.current) viewer.scrollTop = viewer.scrollHeight;
    });
    observer.observe(viewer);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (following.current) setDisplayContent(content);
  }, [content]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A new follow request exits frozen history even when the snapshot text is unchanged.
  useLayoutEffect(() => {
    following.current = true;
    setDisplayContent(latestContent.current);
    setShowLatest(false);
  }, [followRequest]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: These render changes alter scroll geometry or explicitly request following the latest output.
  useLayoutEffect(() => {
    const viewer = viewerRef.current;
    if (viewer && following.current) viewer.scrollTop = viewer.scrollHeight;
  }, [displayContent, fontSize, wrap, followRequest]);
  const changeFont = (delta: number) => {
    const size = Math.min(20, Math.max(6, fontSize + delta));
    setFontSize(size);
    try {
      localStorage.setItem("cmux.remote.fontSize", String(size));
    } catch {
      /* preferences are optional */
    }
  };
  return (
    <section className="terminal-container" aria-label="Terminal">
      {controlsOpen && (
        <div
          ref={controlsRef}
          className="terminal-settings"
          role="dialog"
          aria-label="Display"
          id="terminal-view-controls"
        >
          <div className="settings-heading">
            <span>Display</span>
            <button
              type="button"
              className="icon-button"
              aria-label="Close display settings"
              onClick={onControlsClose}
            >
              <IconX size={18} stroke={1.6} aria-hidden="true" />
            </button>
          </div>
          <fieldset className="text-tools" aria-label="Display">
            <div className="view-modes">
              <button
                type="button"
                aria-pressed={wrap}
                title="Wrap lines and hide terminal frames"
                onClick={() => {
                  setWrap(true);
                  try {
                    localStorage.setItem("cmux.remote.wrap", "true");
                  } catch {
                    /* optional */
                  }
                }}
              >
                Text
              </button>
              <button
                type="button"
                aria-pressed={!wrap}
                title="Exact terminal snapshot"
                onClick={() => {
                  setWrap(false);
                  try {
                    localStorage.setItem("cmux.remote.wrap", "false");
                  } catch {
                    /* optional */
                  }
                }}
              >
                Original
              </button>
            </div>
          </fieldset>
          <div className="font-tools">
            <button
              type="button"
              className="icon-button"
              aria-label="Decrease text size"
              disabled={fontSize === 6}
              onClick={() => changeFont(-1)}
            >
              <IconMinus size={18} stroke={1.6} aria-hidden="true" />
            </button>
            <output aria-label="Text size">{fontSize}px</output>
            <button
              type="button"
              className="icon-button"
              aria-label="Increase text size"
              disabled={fontSize === 20}
              onClick={() => changeFont(1)}
            >
              <IconPlus size={18} stroke={1.6} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
      <section
        ref={viewerRef}
        className="terminal-output"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to focus this scroll region for arrow and Page Up/Down navigation.
        tabIndex={0}
        aria-label="Terminal output"
        onScroll={(event) => {
          const viewer = event.currentTarget;
          following.current = viewer.scrollHeight - viewer.scrollTop - viewer.clientHeight < 32;
          setShowLatest(!following.current);
          if (following.current) setDisplayContent(content);
        }}
      >
        <pre className={wrap ? "wrapped" : ""} style={{ fontSize }}>
          {wrap ? readingText(displayContent) : displayContent}
        </pre>
      </section>
      {showLatest && (
        <button
          type="button"
          className="latest-output"
          aria-label="Latest output"
          onClick={() => {
            const viewer = viewerRef.current;
            if (viewer) viewer.scrollTop = viewer.scrollHeight;
            following.current = true;
            setDisplayContent(content);
            setShowLatest(false);
          }}
        >
          <IconArrowDown size={18} stroke={1.6} aria-hidden="true" />
        </button>
      )}
    </section>
  );
}
