import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MinusIcon, PanelLeftIcon, PanelRightIcon, PlusIcon } from "lucide-react";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Toggle } from "@/components/ui/toggle";
import { FIT_PADDING, FIT_TOP_CLEARANCE, fitRect, initialFrameFit, pan, zoomAt, type Camera, type Rect, type Size } from "./camera";
import { BuildChip } from "./build-chip";
import { boardCommands, commandForKey } from "./commands";
import { DesktopCanvas, InteractChip } from "./desktop-canvas";
import { Inspector } from "./inspector";
import { layout, type Positioned, type Side } from "./layout";
import { MobileReview } from "./mobile-review";
import { Outline } from "./outline";
import { CommandPalette } from "./palette";
import { buildPaletteItems } from "./palette-items";
import { ShortcutsHelp } from "./shortcuts-help";
import { formatFrameStatus, useFrameLoading } from "./use-frame-loading";
import type { ReviewBoard } from "./manifest";
import { changesBoard, hasChangeData, markBuildChanges, resolveBoard, type ReviewBuild, type StoryIndexEntry } from "./review-build";
import { readBoardUrl, revisionLink, storyCanvasUrl, storyManagerUrl, writeBoardUrl } from "./url-state";
import { useVercelCommentsSync } from "./vercel-comments";
import styles from "./board.module.css";

type FrameSource = "story" | "blank";
type StoryIndex = Record<string, StoryIndexEntry>;

type Navigate = (url: string, newTab: boolean) => void;

function navigate(url: string, newTab: boolean) {
  const destination = new URL(url, location.href).href;
  if (newTab) {
    window.open(destination, "_blank", "noopener,noreferrer");
    return;
  }
  try {
    if (window.top && window.top !== window && window.top.location.origin === location.origin) {
      window.top.location.assign(destination);
      return;
    }
  } catch {}
  location.assign(destination);
}

export function ReviewBoardView({ board, build, frameSource = "story", narrow = false,
  storyIndex, onNavigate = navigate }: {
  board: ReviewBoard | "changes";
  build: ReviewBuild;
  frameSource?: FrameSource;
  storyIndex?: StoryIndex;
  onNavigate?: Navigate;
  narrow?: boolean;
}) {
  const [index, setIndex] = useState<StoryIndex | "unavailable" | null | undefined>(
    storyIndex ?? (frameSource === "blank" ? null : undefined));
  useEffect(() => {
    if (frameSource === "blank") return;
    const abort = new AbortController();
    fetch("./index.json", { signal: abort.signal }).then((response) => {
      if (!response.ok) throw new Error("Story index unavailable");
      return response.json() as Promise<{ entries: StoryIndex }>;
    }).then((data) => setIndex(data.entries)).catch(() => {
      if (!abort.signal.aborted) setIndex("unavailable");
    });
    return () => abort.abort();
  }, [frameSource]);
  const resolved = useMemo(() => {
    if (index === undefined || index === "unavailable") return index;
    if (frameSource === "blank" && board !== "changes") return board;
    if (board === "changes") return index ? changesBoard(build, index) : null;
    if (!index) return board;
    const present = resolveBoard(board, index);
    return present && markBuildChanges(present, build, index);
  }, [board, build, index, frameSource]);
  const title = board === "changes" ? "Story changes" : board.title;
  if (resolved === undefined) return <BoardMessage title={title} build={build}>Loading board…</BoardMessage>;
  if (resolved === "unavailable") return <BoardMessage title={title} build={build}>
    Couldn&apos;t load this build&apos;s story list. Reload to try again.
  </BoardMessage>;
  if (resolved === null) return <BoardMessage title={title} build={build}>
    {board === "changes" ? !hasChangeData(build) || !index
      ? "Change data isn't available for this build."
      : "No story changes in this build." : "No stories from this board are in this build."}
  </BoardMessage>;
  return <BoardCanvas board={resolved} build={build} frameSource={frameSource} narrow={narrow}
    index={typeof index === "object" ? index : null} onNavigate={onNavigate} />;
}

function BoardMessage({ title, build, children }: { title: string; build: ReviewBuild; children: string }) {
  return <div className={styles.board} data-review-board="message">
    <header className={styles.header}>
      <h1 title={title}>{title}</h1>
      <BuildChip build={build} />
    </header>
    <main className={styles.content} aria-label="Review board">
      <Empty className={styles.empty}><EmptyDescription role="status">{children}</EmptyDescription></Empty>
    </main>
  </div>;
}

function BoardCanvas({ board, build, frameSource, narrow, index, onNavigate }: {
  board: ReviewBoard;
  build: ReviewBuild;
  frameSource: FrameSource;
  narrow: boolean;
  index: StoryIndex | null;
  onNavigate: Navigate;
}) {
  const { revision, deployment } = build;
  const allFrames = useMemo(() => board.sections.flatMap((section) =>
    section.frames.map((frame) => ({ section, frame }))), [board]);
  const original = useMemo(() => typeof window === "undefined"
    ? undefined : readBoardUrl(new URL(location.href)), []);
  const linkedFrame = original?.frame && allFrames.some(({ frame }) => frame.id === original.frame)
    ? original.frame : undefined;
  const staleFrame = original?.frame && !linkedFrame ? original.frame : undefined;
  const initialFrame = linkedFrame ?? allFrames[0].frame.id;
  const hasBefore = allFrames.some(({ frame }) => frame.before);
  const linkedHasBefore = Boolean(allFrames.find(({ frame }) => frame.id === initialFrame)?.frame.before);
  const linkedSide = linkedHasBefore ? original?.side ?? "after" : "after";
  const [side, setSide] = useState<Side>(linkedSide);
  const [selected, setSelected] = useState(initialFrame);
  const [selectedVariant, setSelectedVariant] = useState<string | undefined>(
    linkedSide === "both" && original?.variant === "before" && linkedFrame
      ? `${linkedFrame}:before` : undefined,
  );
  const [mobile, setMobile] = useState(narrow);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [overlayReturn, setOverlayReturn] = useState<HTMLElement | null>(null);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const [interacting, setInteracting] = useState<string>();
  const [spacePan, setSpacePan] = useState(false);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [transition, setTransition] = useState(false);
  const [activeFrameReady, setActiveFrameReady] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const [focusFallback, setFocusFallback] = useState<HTMLDivElement | null>(null);
  const setContainer = useCallback((node: HTMLDivElement | null) => {
    container.current = node;
    setFocusFallback(node);
  }, []);
  const boardElement = useRef<HTMLDivElement>(null);
  const lastBoardFocus = useRef<HTMLElement | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const canvasLeft = useRef<number | null>(null);
  const actionButton = useRef<HTMLButtonElement>(null);
  useVercelCommentsSync({ camera, canvasRef: canvas, enabled: !mobile && viewport.width > 0 });
  const activeFrame = useRef<HTMLIFrameElement>(null);
  const lastWidth = useRef<number | null>(null);
  const firstFit = useRef(false);
  const pendingFit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const geometry = useMemo(() => layout(board, side), [board, side]);
  const positions = useMemo(() => geometry.sections.flatMap((section) => section.frames), [geometry]);
  const selectedPosition = positions.find((position) => position.id === selectedVariant &&
    position.frame.id === selected) ?? positions.find((position) => position.frame.id === selected &&
    !position.before) ?? positions.find((position) => position.frame.id === selected) ?? positions[0];
  const selectedSection = geometry.sections.find((section) => section.frames.includes(selectedPosition));
  const stepSection = (direction: -1 | 1) => {
    const current = geometry.sections.findIndex((section) => section.id === selectedSection?.id);
    const next = geometry.sections[Math.max(0, Math.min(geometry.sections.length - 1, current + direction))];
    if (!next) return;
    select(next.frames[0].frame.id, next.frames[0].id);
    const after = side !== "after" && !next.frames[0].frame.before
      ? layout(board, "after").sections.find((section) => section.id === next.id) : undefined;
    fit((after ?? next).rect);
  };
  const interactingPosition = positions.find((position) => position.id === interacting);
  const center = useMemo(() => ({
    x: (viewport.width / 2 - camera.x) / camera.zoom,
    y: (viewport.height / 2 - camera.y) / camera.zoom,
  }), [viewport.width, viewport.height, camera]);
  const { metrics, loaded, mark, finish, cancel } = useFrameLoading(
    board.id, revision, positions, center, mobile ? selectedPosition.id : undefined,
  );
  const currentIndex = Math.max(0, allFrames.findIndex(({ frame }) => frame.id === selected));
  const current = allFrames[currentIndex];
  const mismatch = original?.rev && original.rev !== revision;
  const originalLink = original?.deployment && revisionLink(original.deployment,
    writeBoardUrl(new URL(typeof window === "undefined" ? "http://localhost/iframe.html" : location.href),
      { rev: original.rev, deployment: original.deployment }));
  const canInteract = loaded.has(selectedPosition.id);
  const previewUpdated = metrics.frames.some((entry) => entry.error === "This preview was updated");
  const updateUrl = useCallback((update: { frame?: string; side?: Side; variant?: "before";
    rev?: string; deployment?: string }) => {
    history.replaceState(history.state, "", writeBoardUrl(new URL(location.href), update));
  }, []);
  useEffect(() => {
    updateUrl({ rev: revision, deployment: deployment || undefined,
      side: linkedSide === "after" ? undefined : linkedSide,
      frame: initialFrame,
      variant: linkedSide === "both" && linkedFrame ? original?.variant : undefined });
  }, [revision, deployment, updateUrl, linkedSide, linkedFrame, original?.variant, initialFrame]);
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => {
      const width = element.clientWidth;
      setMobile(narrow || width < 768);
      if (lastWidth.current === null || (lastWidth.current >= 1280) !== (width >= 1280)) {
        setOutlineOpen(width >= 1280);
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
        setCamera(initial);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (canvas.current) observer.observe(canvas.current);
    return () => observer.disconnect();
  }, [narrow, mobile, linkedFrame, linkedSide, original?.variant, positions, geometry]);
  const fit = useCallback((rect: Rect) => {
    if (!viewport.width || !viewport.height) return;
    setTransition(true);
    setCamera(fitRect(viewport, rect, FIT_PADDING, FIT_TOP_CLEARANCE));
  }, [viewport]);
  const fitAll = () => fit({ x: 0, y: 0, ...geometry.size });
  const moveCamera = useCallback((updater: (old: Camera) => Camera) => {
    setTransition(false);
    setCamera(updater);
  }, []);
  useLayoutEffect(() => {
    const left = canvas.current?.getBoundingClientRect().left ?? null;
    const previous = canvasLeft.current;
    canvasLeft.current = left;
    if (previous === null || left === null || previous === left) return;
    moveCamera((old) => ({ ...old, x: old.x + previous - left }));
  }, [outlineOpen, mobile, moveCamera]);
  const zoom = (factor: number) =>
    moveCamera((old) => zoomAt(old, { x: viewport.width / 2, y: viewport.height / 2 }, factor));
  const select = (id: string, variant?: string) => {
    const hasBefore = allFrames.some(({ frame }) => frame.id === id && frame.before);
    if (!hasBefore && side !== "after") setSide("after");
    const before = hasBefore && side === "both" && variant === `${id}:before`;
    setSelected(id);
    setInteracting((old) => old === (variant ?? id) ? old : undefined);
    setSelectedVariant(before ? variant : undefined);
    updateUrl({ frame: id, variant: before ? "before" : undefined,
      ...(!hasBefore ? { side: undefined } : {}) });
  };
  const fitPosition = (position: Positioned) => {
    const next = !position.frame.before && side !== "after"
      ? layout(board, "after").sections.flatMap((section) => section.frames)
        .find((item) => item.id === position.id) : position;
    fit((next ?? position).rect);
  };
  const selectAndFit = (id: string) => {
    const position = positions.find((item) => item.id === id);
    if (!position) return;
    if (pendingFit.current !== null) clearTimeout(pendingFit.current);
    pendingFit.current = null;
    select(position.frame.id, position.id);
    fitPosition(position);
  };
  const selectFromCanvas = (position: Positioned) => {
    select(position.frame.id, position.id);
    if (pendingFit.current !== null) clearTimeout(pendingFit.current);
    pendingFit.current = setTimeout(() => {
      pendingFit.current = null;
      fitPosition(position);
    }, 275);
  };
  useEffect(() => () => {
    if (pendingFit.current !== null) clearTimeout(pendingFit.current);
  }, []);
  const interact = (position: Positioned) => {
    if (loaded.has(position.id)) setInteracting(position.id);
  };
  const leave = useCallback(() => {
    setInteracting(undefined);
    requestAnimationFrame(() => {
      if (mobile) actionButton.current?.focus({ preventScroll: true });
      else container.current?.querySelector<HTMLElement>(
        `[data-review-frame="${CSS.escape(selectedVariant ?? selected)}"]`,
      )?.focus({ preventScroll: true });
    });
  }, [mobile, selected, selectedVariant]);
  useEffect(() => {
    const root = boardElement.current;
    const childListeners = new Map<HTMLIFrameElement, { doc: Document; listener: () => void }>();
    const restoreBoardFocus = (focused: Element | null = document.activeElement) => {
      if (helpOpen) return;
      if (!(focused instanceof HTMLIFrameElement) || !root?.contains(focused) ||
        focused === activeFrame.current) return;
      try {
        (focused.contentDocument?.activeElement as HTMLElement | null)?.blur();
        focused.contentWindow?.blur();
      } catch { /* Cross-origin frame. */ }
      window.focus();
      if (paletteOpen) {
        document.querySelector<HTMLInputElement>('input[aria-label="Search board navigation"]')
          ?.focus({ preventScroll: true });
        return;
      }
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
  }, [paletteOpen, helpOpen]);
  useEffect(() => {
    if (!interacting) return;
    const iframe = activeFrame.current;
    const child = iframe?.contentWindow;
    iframe?.focus({ preventScroll: true });
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); leave(); }
    };
    window.addEventListener("keydown", escape);
    try { child?.addEventListener("keydown", escape, true); } catch { /* Detached frame. */ }
    return () => {
      window.removeEventListener("keydown", escape);
      try { child?.removeEventListener("keydown", escape, true); } catch { /* Detached frame. */ }
    };
  }, [interacting, leave, activeFrameReady]);
  const selectedHasBefore = Boolean(allFrames.find(({ frame }) => frame.id === selected)?.frame.before);
  const changeSide = (requested: Side) => {
    const value = requested === "before" && !selectedHasBefore ? "after" : requested;
    setSide(value);
    setInteracting(undefined);
    setSelectedVariant(undefined);
    if (!mobile) fit({ x: 0, y: 0, ...layout(board, value).size });
    updateUrl({ side: value, variant: undefined });
  };
  const openOverlay = (open: (value: boolean) => void) => {
    if (!paletteOpen && !helpOpen && document.activeElement instanceof HTMLElement)
      setOverlayReturn(document.activeElement);
    open(true);
  };
  const overlayFocus = () => overlayReturn?.isConnected ? overlayReturn : focusFallback;
  const overlayChange = (change: (next: boolean) => void) => (next: boolean) => change(next);
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) focusFallback?.focus({ preventScroll: true });
  }, [outlineOpen, inspectorOpen, focusFallback]);
  const commands = boardCommands({
    fitBoard: fitAll,
    fitSelection: () => fit(selectedPosition.rect),
    stepSection: (direction) => stepSection(direction),
    zoom,
    zoomReset: () => zoom(1 / camera.zoom),
    pan: (x, y) => moveCamera((old) => pan(old, { x, y })),
    toggleOutline: () => {
      setOutlineOpen((old) => !old);
    },
    toggleInspector: () => {
      setInspectorOpen((old) => !old);
    },
    interact: () => interact(selectedPosition),
    canInteract,
    openStory: () => window.open(storyManagerUrl(selectedPosition.story), "_blank", "noreferrer"),
    openCanvas: () => window.open(storyCanvasUrl(selectedPosition.story), "_blank", "noreferrer"),
    copyLink: () => void navigator.clipboard?.writeText(location.href).catch(() => undefined),
    openPalette: () => openOverlay(setPaletteOpen),
    openShortcuts: () => openOverlay(setHelpOpen),
  });
  const onKey = (event: globalThis.KeyboardEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("input, select, textarea, [contenteditable]")) return;
    if (event.defaultPrevented && event.key !== " ") return;
    const onControl = Boolean(target?.closest("a[href], button"));
    if (event.key === " " && !onControl && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (!event.repeat) setSpacePan(true);
      event.preventDefault();
      return;
    }
    const command = commandForKey(commands, event, onControl);
    if (!command) return;
    event.preventDefault();
    command.run?.(event);
  };
  const keyHandler = useRef(onKey);
  useEffect(() => { keyHandler.current = onKey; });
  const keysActive = !mobile && !interacting && !paletteOpen && !helpOpen;
  useEffect(() => {
    if (!keysActive) return;
    const down = (event: globalThis.KeyboardEvent) => keyHandler.current(event);
    const up = (event: globalThis.KeyboardEvent) => { if (event.key === " ") setSpacePan(false); };
    const reset = () => setSpacePan(false);
    document.addEventListener("keydown", down);
    document.addEventListener("keyup", up);
    window.addEventListener("blur", reset);
    return () => {
      document.removeEventListener("keydown", down);
      document.removeEventListener("keyup", up);
      window.removeEventListener("blur", reset);
      setSpacePan(false);
    };
  }, [keysActive]);
  return <div ref={boardElement} className={styles.board} data-review-board={board.id}>
    <header className={styles.header}>
      {!mobile && <Toggle size="sm" aria-label="Outline" title="Toggle outline ([)"
        pressed={outlineOpen} onPressedChange={setOutlineOpen}>
        <PanelLeftIcon />
      </Toggle>}
      <h1 title={board.title}>{board.title}</h1>
      {mobile && <span className={styles.position}>{currentIndex + 1} of {allFrames.length}</span>}
      <BuildChip build={build} />
      {!mobile && <>
        <span className={styles.renderStatus} role="status">{formatFrameStatus(metrics)}</span>
        <nav className={styles.toolbar} aria-label="Board controls">
          {hasBefore && <select className={styles.sideSelect} aria-label="Before and after" value={side}
            onChange={(event) => changeSide(event.target.value as Side)}>
            <option value="after">Proposed</option>
            <option value="before" disabled={!selectedHasBefore}>Before</option>
            <option value="both">Side by side</option>
          </select>}
          <div className={styles.zoomGroup} role="group" aria-label="Zoom">
            <Button variant="ghost" size="icon-sm" aria-label="Zoom out" title="Zoom out (−)"
              disabled={camera.zoom <= 0.05} onClick={() => zoom(1 / 1.2)}><MinusIcon /></Button>
            <Button variant="ghost" size="sm" className={styles.zoomValue} aria-label="Reset zoom to 100%"
              title="Zoom to 100%" onClick={() => zoom(1 / camera.zoom)}>
              {Math.round(camera.zoom * 100)}%
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Zoom in" title="Zoom in (+)"
              disabled={camera.zoom >= 2} onClick={() => zoom(1.2)}><PlusIcon /></Button>
          </div>
          <Button variant="outline" size="sm" title="Fit board (⇧1)" onClick={fitAll}>Fit board</Button>
        </nav>
        <Toggle size="sm" aria-label="Inspector" title="Toggle inspector (])"
          pressed={inspectorOpen} onPressedChange={setInspectorOpen}>
          <PanelRightIcon />
        </Toggle>
      </>}
    </header>
    {(mismatch || staleFrame) && <div className={styles.banner} role="status">
      {mismatch && <>Opened from a comment on revision {original.rev?.slice(0, 7)}; this is {revision.slice(0, 7)}. </>}
      {staleFrame && <>Frame “{staleFrame}” is not on this revision; showing the first frame.</>}
      {mismatch && originalLink && <a href={originalLink}>Open original deployment</a>}
    </div>}
    {previewUpdated && <Alert className={styles.updateBanner}>
      <AlertDescription>A newer build of this preview is available.</AlertDescription>
      <AlertAction>
        <Button variant="outline" size="sm" onClick={() => location.reload()}>Reload</Button>
      </AlertAction>
    </Alert>}
    <main ref={setContainer} className={styles.content} tabIndex={-1} aria-label="Review board">
      {mobile ? <MobileReview
        board={board} current={current} position={selectedPosition} index={currentIndex}
        metric={metrics.frames.find((entry) => entry.id === selectedPosition.id)}
        loaded={loaded.has(selectedPosition.id)} interacting={interacting === selectedPosition.id}
        frameSource={frameSource} actionButton={actionButton} activeFrame={activeFrame}
        onSelect={select} onSide={changeSide}
        onInteract={() => interact(selectedPosition)} onLeave={leave}
        onActiveLoad={() => setActiveFrameReady((old) => old + 1)}
        onMark={mark} onFinish={finish} onCancel={cancel}
      /> : <div className={styles.desktop}>
        {outlineOpen && <Outline board={board} sections={geometry.sections} selected={selectedPosition.id} inPr={build.pr !== null}
          onSelect={selectAndFit} onFitSection={(section) => fit(section.rect)} />}
        <div ref={canvas} className={styles.canvasHost}>
          <DesktopCanvas
            sections={geometry.sections} positions={positions} size={geometry.size}
            camera={camera} transition={transition} selected={selectedPosition.id}
            interacting={interacting} spacePan={spacePan} loaded={loaded} metrics={metrics.frames}
            frameSource={frameSource} activeFrame={activeFrame}
            onActiveFrameLoad={() => setActiveFrameReady((old) => old + 1)}
            moveCamera={moveCamera}
            onSelect={selectFromCanvas}
            onFocusSelect={(position) => select(position.frame.id, position.id)}
            onFit={(position) => selectAndFit(position.id)}
            onInteract={(position) => { selectAndFit(position.id); interact(position); }}
            onExitInteract={() => setInteracting(undefined)}
            onMark={mark} onFinish={finish} onCancel={cancel}
          />
          {interactingPosition && <InteractChip position={interactingPosition} camera={camera}
            viewportWidth={viewport.width} />}
        </div>
        {inspectorOpen && <Inspector section={selectedSection} position={selectedPosition}
          onInteract={() => interact(selectedPosition)} canInteract={canInteract}
          onFit={() => fit(selectedPosition.rect)}
          shortcuts={commands.filter((command) => command.featured)} onShowShortcuts={() => openOverlay(setHelpOpen)} />}
      </div>}
    </main>
    {!mobile && <>
      <CommandPalette open={paletteOpen} onOpenChange={overlayChange(setPaletteOpen)}
        items={() => buildPaletteItems({ commands, sections: geometry.sections, index,
          boardId: board.id, selectFrame: selectAndFit, fitSection: (section) => fit(section.rect), navigate: onNavigate })}
        returnFocus={overlayFocus} />
      <ShortcutsHelp open={helpOpen} onOpenChange={overlayChange(setHelpOpen)} commands={commands}
        returnFocus={overlayFocus} />
    </>}
  </div>;
}
