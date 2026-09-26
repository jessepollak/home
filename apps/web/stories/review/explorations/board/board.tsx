import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { fitRect, initialFrameFit, pan, zoomAt, type Camera, type Rect, type Size } from "./camera";
import { DesktopCanvas } from "./desktop-canvas";
import { Inspector } from "./inspector";
import { layout, type Positioned, type Side } from "./layout";
import { MobileReview } from "./mobile-review";
import { Outline } from "./outline";
import { formatFrameStatus, useFrameLoading } from "./use-frame-loading";
import type { ReviewBoard } from "./manifest";
import { readBoardUrl, revisionLink, storyCanvasUrl, writeBoardUrl } from "./url-state";
import styles from "./board.module.css";

export function ReviewBoardView({
  board, revision = "local", deployment = "", branch = "", frameSource = "story", narrow = false,
}: {
  board: ReviewBoard;
  revision?: string;
  deployment?: string;
  branch?: string;
  frameSource?: "story" | "blank";
  narrow?: boolean;
}) {
  const original = useMemo(() => typeof window === "undefined"
    ? undefined : readBoardUrl(new URL(location.href)), []);
  const initialFrame = board.sections[0].frames[0].id;
  const linkedFrame = original?.frame && board.sections.some((section) =>
    section.frames.some((frame) => frame.id === original.frame)) ? original.frame : undefined;
  const staleFrame = original?.frame && !linkedFrame ? original.frame : undefined;
  const hasBefore = board.sections.some((section) => section.frames.some((frame) => frame.before));
  const linkedSide = hasBefore ? original?.side ?? "after" : "after";
  const [side, setSide] = useState<Side>(linkedSide);
  const [selected, setSelected] = useState(linkedFrame ?? initialFrame);
  const [selectedVariant, setSelectedVariant] = useState<string | undefined>(
    linkedSide === "both" && original?.variant === "before" && linkedFrame
      ? `${linkedFrame}:before` : undefined,
  );
  const [mobile, setMobile] = useState(narrow);
  const [collapsed, setCollapsed] = useState(false);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const [requestedInteraction, setInteracting] = useState<string>();
  const [full, setFull] = useState(false);
  const [available, setAvailable] = useState<Set<string> | null>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [transition, setTransition] = useState(false);
  const [activeFrameReady, setActiveFrameReady] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const boardElement = useRef<HTMLDivElement>(null);
  const lastBoardFocus = useRef<HTMLElement | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const fullButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const activeFrame = useRef<HTMLIFrameElement>(null);
  const lastWidth = useRef<number | null>(null);
  const firstFit = useRef(false);
  const geometry = useMemo(() => layout(board, side), [board, side]);
  const positions = useMemo(() => geometry.sections.flatMap((section) => section.frames), [geometry]);
  const selectedPosition = positions.find((position) => position.id === selectedVariant &&
    position.frame.id === selected) ?? positions.find((position) => position.frame.id === selected &&
    !position.before) ?? positions.find((position) => position.frame.id === selected);
  const selectedSection = geometry.sections.find((section) => section.frames.includes(selectedPosition!));
  const selectedMissing = available !== null && !available.has(selectedPosition?.story ?? "");
  const dialogOpen = full && selectedPosition !== undefined && !selectedMissing;
  const interactingPosition = positions.find((position) => position.id === requestedInteraction);
  const interactingMissing = !interactingPosition ||
    (available !== null && !available.has(interactingPosition.story));
  const interacting = interactingMissing ? undefined : requestedInteraction;
  const center = useMemo(() => ({
    x: (viewport.width / 2 - camera.x) / camera.zoom,
    y: (viewport.height / 2 - camera.y) / camera.zoom,
  }), [viewport.width, viewport.height, camera]);
  const { metrics, loaded, mark, finish, cancel } = useFrameLoading(
    board.id, revision, positions, available, center, mobile ? selectedPosition?.id : undefined,
  );
  const allFrames = board.sections.flatMap((section) => section.frames.map((frame) => ({ section, frame })));
  const currentIndex = Math.max(0, allFrames.findIndex(({ frame }) => frame.id === selected));
  const current = allFrames[currentIndex];
  const mismatch = original?.rev && original.rev !== revision;
  const originalLink = original?.deployment && revisionLink(original.deployment,
    writeBoardUrl(new URL(typeof window === "undefined" ? "http://localhost/iframe.html" : location.href),
      { rev: original.rev, deployment: original.deployment }));
  const updateUrl = useCallback((update: { frame?: string; side?: Side; variant?: "before";
    rev?: string; deployment?: string }) => {
    history.replaceState(history.state, "", writeBoardUrl(new URL(location.href), update));
  }, []);
  useEffect(() => {
    updateUrl({ rev: revision, deployment: deployment || undefined,
      side: linkedSide === "after" ? undefined : linkedSide,
      frame: linkedFrame ?? initialFrame,
      variant: linkedSide === "both" && linkedFrame ? original?.variant : undefined });
    const abort = new AbortController();
    if (frameSource === "story") {
      fetch("./index.json", { signal: abort.signal }).then((response) => {
        if (!response.ok) throw new Error("Story index unavailable");
        return response.json() as Promise<{ entries: Record<string, unknown> }>;
      }).then((index) => {
        const hadDialog = closeButton.current !== null;
        setAvailable(new Set(Object.keys(index.entries)));
        requestAnimationFrame(() => {
          if (!hadDialog || closeButton.current !== null) return;
          const button = fullButton.current;
          (button && !button.disabled ? button : container.current)?.focus({ preventScroll: true });
        });
      }).catch(() => {});
    }
    return () => abort.abort();
  }, [revision, deployment, frameSource, updateUrl, linkedFrame, linkedSide,
    original?.variant, initialFrame]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const width = element.clientWidth;
      setMobile(narrow || width < 768);
      if (lastWidth.current === null || (lastWidth.current >= 1280) !== (width >= 1280)) {
        setCollapsed(width < 1280);
      }
      lastWidth.current = width;
      const canvasElement = canvas.current;
      if (!canvasElement) return;
      const next = { width: canvasElement.clientWidth, height: canvasElement.clientHeight };
      setViewport((old) => old.width === next.width && old.height === next.height ? old : next);
      const target = linkedFrame
        ? positions.find((position) => position.id === (
          linkedSide === "both" && original?.variant === "before"
            ? `${linkedFrame}:before` : linkedFrame)) : undefined;
      const initial = initialFrameFit(next, target?.rect ?? { x: 0, y: 0, ...geometry.size },
        firstFit.current);
      if (initial) {
        firstFit.current = true;
        setTransition(true);
        setCamera(initial);
      }
    });
    observer.observe(element);
    if (canvas.current) observer.observe(canvas.current);
    return () => observer.disconnect();
  }, [narrow, mobile, linkedFrame, linkedSide, original?.variant, positions, geometry]);
  const fit = useCallback((rect: Rect) => {
    if (!viewport.width || !viewport.height) return;
    setTransition(true);
    setCamera(fitRect(viewport, rect, 32));
  }, [viewport]);
  const select = (id: string, variant?: string) => {
    const before = side === "both" && variant === `${id}:before`;
    setSelected(id);
    setFull(false);
    setInteracting((old) => old === (variant ?? id) ? old : undefined);
    setSelectedVariant(before ? variant : undefined);
    updateUrl({ frame: id, variant: before ? "before" : undefined });
  };
  const selectAndFit = (id: string) => {
    const position = positions.find((item) => item.id === id);
    if (!position) return;
    select(position.frame.id, position.id);
    fit(position.rect);
  };
  const leave = useCallback(() => {
    setInteracting(undefined);
    setFull(false);
    requestAnimationFrame(() => {
      if (dialogOpen) fullButton.current?.focus();
      else container.current?.querySelector<HTMLElement>(
        `[data-review-frame="${CSS.escape(selectedVariant ?? selected)}"]`,
      )?.focus();
    });
  }, [dialogOpen, selected, selectedVariant]);
  useEffect(() => {
    if (dialogOpen) closeButton.current?.focus();
  }, [dialogOpen]);
  useEffect(() => {
    const root = boardElement.current;
    const childListeners = new Map<HTMLIFrameElement, { doc: Document; listener: () => void }>();
    const restoreBoardFocus = (focused: Element | null = document.activeElement) => {
      if (!(focused instanceof HTMLIFrameElement) || !root?.contains(focused) ||
        focused === activeFrame.current) return;
      try {
        (focused.contentDocument?.activeElement as HTMLElement | null)?.blur();
        focused.contentWindow?.blur();
      } catch { /* Cross-origin frame. */ }
      window.focus();
      const previous = lastBoardFocus.current;
      (previous?.isConnected && root.contains(previous) ? previous : container.current)
        ?.focus({ preventScroll: true });
    };
    const watchFrame = (frame: HTMLIFrameElement) => {
      const previous = childListeners.get(frame);
      if (previous) previous.doc.removeEventListener("focusin", previous.listener);
      try {
        const doc = frame.contentDocument;
        if (!doc) return;
        const listener = () => restoreBoardFocus(frame);
        doc.addEventListener("focusin", listener);
        childListeners.set(frame, { doc, listener });
      } catch { /* Cross-origin frame. */ }
    };
    const onLoad = (event: Event) => {
      if (event.target instanceof HTMLIFrameElement && root?.contains(event.target))
        watchFrame(event.target);
    };
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && root?.contains(event.target) &&
        !(event.target instanceof HTMLIFrameElement)) lastBoardFocus.current = event.target;
      restoreBoardFocus();
    };
    root?.querySelectorAll("iframe").forEach(watchFrame);
    root?.addEventListener("load", onLoad, true);
    document.addEventListener("focusin", onFocus);
    const onBlur = () => restoreBoardFocus();
    window.addEventListener("blur", onBlur);
    return () => {
      root?.removeEventListener("load", onLoad, true);
      document.removeEventListener("focusin", onFocus);
      window.removeEventListener("blur", onBlur);
      for (const { doc, listener } of childListeners.values()) doc.removeEventListener("focusin", listener);
    };
  }, []);
  useEffect(() => {
    if (!interacting && !dialogOpen) return;
    const iframe = activeFrame.current;
    const child = iframe?.contentWindow;
    if (!dialogOpen) iframe?.focus();
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); leave(); }
    };
    window.addEventListener("keydown", escape);
    try { child?.addEventListener("keydown", escape); } catch { /* Detached frame. */ }
    return () => {
      window.removeEventListener("keydown", escape);
      try { child?.removeEventListener("keydown", escape); } catch { /* Detached frame. */ }
    };
  }, [interacting, dialogOpen, leave, activeFrameReady]);
  const changeSide = (value: Side) => {
    setSide(value);
    setFull(false);
    setInteracting(undefined);
    setSelectedVariant(undefined);
    if (!mobile) fit({ x: 0, y: 0, ...layout(board, value).size });
    updateUrl({ side: value, variant: undefined });
  };
  const zoom = (factor: number) => {
    setTransition(false);
    setCamera((old) => zoomAt(old, { x: viewport.width / 2, y: viewport.height / 2 }, factor));
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof Element &&
      event.target.closest("a[href], button, input, select, textarea, [contenteditable]")) return;
    if (event.key === "Enter" && selectedPosition && !selectedMissing && loaded.has(selectedPosition.id)) {
      event.preventDefault();
      setInteracting(selectedPosition.id);
      return;
    }
    if (event.key === "+" || event.key === "=") zoom(1.2);
    else if (event.key === "-") zoom(1 / 1.2);
    else if (event.key === "0") zoom(1 / camera.zoom);
    else if (event.key === "1") fit({ x: 0, y: 0, ...geometry.size });
    else if (event.key === "2" || event.key.toLowerCase() === "f") {
      fit(selectedPosition?.rect ?? geometry.sections[0].rect);
    } else if (event.key.startsWith("Arrow")) {
      const step = event.shiftKey ? 120 : 40;
      setTransition(false);
      setCamera((old) => pan(old, {
        x: event.key === "ArrowLeft" ? step : event.key === "ArrowRight" ? -step : 0,
        y: event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0,
      }));
    } else return;
    event.preventDefault();
  };
  const handleSelect = (position: Positioned) => select(position.frame.id, position.id);
  return <div ref={boardElement} className={styles.board} data-review-board={board.id}>
    <header className={styles.header} inert={dialogOpen}>
      <h1 title={board.title}>{board.title}</h1>
      {mobile && <span className={styles.position}>{currentIndex + 1} of {allFrames.length}</span>}
      <span className={styles.revision} title={branch ? `${revision} · ${branch}` : revision}>
        {revision.slice(0, 7)}{branch ? ` · ${branch}` : ""}
      </span>
      {!mobile && <>
        <span className={styles.renderStatus} role="status">
          {formatFrameStatus(metrics)}
        </span>
        <nav className={styles.toolbar} aria-label="Board controls">
          <button aria-label="Zoom out" disabled={camera.zoom <= 0.05}
            onClick={() => zoom(1 / 1.2)}>−</button>
          <button aria-label="Reset zoom to 100%" onClick={() => zoom(1 / camera.zoom)}>
            {Math.round(camera.zoom * 100)}%
          </button>
          <button aria-label="Zoom in" disabled={camera.zoom >= 2} onClick={() => zoom(1.2)}>+</button>
          <button onClick={() => fit({ x: 0, y: 0, ...geometry.size })}>Fit board</button>
          {hasBefore && <select aria-label="Before and after" value={side}
            onChange={(event) => changeSide(event.target.value as Side)}>
            <option value="after">Proposed</option>
            <option value="before">Before</option>
            <option value="both">Side by side</option>
          </select>}
          <span className={styles.mode}>{interacting ? "Interacting · Esc" : "Navigate"}</span>
        </nav>
      </>}
    </header>
    {(mismatch || staleFrame) && <div className={styles.banner} role="status" inert={dialogOpen}>
      {mismatch && <>Opened from a comment on revision {original.rev?.slice(0, 7)}; this is {revision.slice(0, 7)}. </>}
      {staleFrame && <>Frame “{staleFrame}” is not on this revision; showing the first frame.</>}
      {mismatch && originalLink && <a href={originalLink}>Open original deployment</a>}
    </div>}
    <main ref={container} className={styles.content} tabIndex={-1} aria-label="Review board"
      inert={dialogOpen}
      onKeyDown={!mobile ? onKey : undefined}>
      {mobile ? <MobileReview
        board={board} current={current} position={selectedPosition} index={currentIndex}
        metric={metrics.frames.find((entry) => entry.id === selectedPosition?.id)}
        loaded={loaded.has(selectedPosition?.id ?? "")}
        missing={selectedMissing}
        frameSource={frameSource} fullButton={fullButton} onSelect={select} onSide={changeSide}
        onOpen={() => { if (!selectedMissing) setFull(true); }} onMark={mark} onFinish={finish}
        onCancel={cancel}
      /> : <div className={styles.desktop}>
        <Outline board={board} sections={geometry.sections} selected={selectedPosition?.id}
          collapsed={collapsed} onToggle={() => setCollapsed((old) => !old)}
          onSelect={selectAndFit} onFitSection={(section) => fit(section.rect)} />
        <div ref={canvas} className={styles.canvasHost}>
          <DesktopCanvas
            sections={geometry.sections} positions={positions} size={geometry.size}
            camera={camera} transition={transition} selected={selectedPosition?.id}
            interacting={interacting} loaded={loaded} metrics={metrics.frames}
            available={available} frameSource={frameSource} activeFrame={activeFrame}
            onActiveFrameLoad={() => setActiveFrameReady((old) => old + 1)}
            setCamera={(updater) => { setTransition(false); setCamera(updater); }}
            onSelect={handleSelect} onInteract={(position) => {
              handleSelect(position);
              if (available !== null && !available.has(position.story)) return;
              if (loaded.has(position.id)) setInteracting(position.id);
            }} onMark={mark} onFinish={finish} onCancel={cancel}
          />
        </div>
        <Inspector board={board} section={selectedSection} position={selectedPosition}
          missing={selectedMissing}
          onInteract={() => selectedPosition && !selectedMissing && loaded.has(selectedPosition.id) &&
            setInteracting(selectedPosition.id)}
          canInteract={loaded.has(selectedPosition?.id ?? "")}
          onFit={() => selectedPosition && fit(selectedPosition.rect)} />
      </div>}
    </main>
    {dialogOpen && <div className={styles.fullscreen} role="dialog" aria-modal="true"
      aria-label={`${selectedPosition.frame.label} full width`}>
      <span tabIndex={0} className={styles.focusSentinel} onFocus={() => activeFrame.current?.focus()} />
      <div><strong>{selectedPosition.frame.label}</strong>
        <button ref={closeButton} aria-label="Close full width" onClick={leave}>Close</button></div>
      <iframe ref={activeFrame} title={`${selectedPosition.frame.label} full width`}
        src={frameSource === "blank" ? "about:blank" : storyCanvasUrl(selectedPosition.story)}
        onLoad={() => setActiveFrameReady((old) => old + 1)} />
      <span tabIndex={0} className={styles.focusSentinel} onFocus={() => closeButton.current?.focus()} />
    </div>}
  </div>;
}
