import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MinusIcon, PanelLeftIcon, PanelRightIcon, PlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Toggle } from "@/components/ui/toggle";
import { fitRect, initialFrameFit, pan, zoomAt, type Camera, type Rect, type Size } from "./camera";
import { BuildChip } from "./build-chip";
import { boardCommands, commandForKey } from "./commands";
import { DesktopCanvas } from "./desktop-canvas";
import { Inspector } from "./inspector";
import { Kbd } from "./kbd";
import { frameLabel, layout, type Positioned, type Side } from "./layout";
import { MobileReview } from "./mobile-review";
import { Outline } from "./outline";
import { CommandPalette, type PaletteItem } from "./palette";
import { ShortcutsHelp } from "./shortcuts-help";
import { formatFrameStatus, useFrameLoading } from "./use-frame-loading";
import type { ReviewBoard } from "./manifest";
import { changesBoard, hasChangeData, markBuildChanges, resolveBoard, type ReviewBuild, type StoryIndexEntry } from "./review-build";
import { readBoardUrl, revisionLink, storyCanvasUrl, storyManagerUrl, writeBoardUrl } from "./url-state";
import styles from "./board.module.css";

type FrameSource = "story" | "blank";
type StoryIndex = Record<string, StoryIndexEntry>;

export function ReviewBoardView({ board, build, frameSource = "story", narrow = false }: {
  board: ReviewBoard | "changes";
  build: ReviewBuild;
  frameSource?: FrameSource;
  narrow?: boolean;
}) {
  const [index, setIndex] = useState<StoryIndex | "unavailable" | null | undefined>(
    frameSource === "blank" ? null : undefined);
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
    if (board === "changes") return index ? changesBoard(build, index) : null;
    if (!index) return board;
    const present = resolveBoard(board, index);
    return present && markBuildChanges(present, build, index);
  }, [board, build, index]);
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
  return <BoardCanvas board={resolved} build={build} frameSource={frameSource} narrow={narrow} />;
}

function BoardMessage({ title, build, children }: { title: string; build: ReviewBuild; children: string }) {
  return <div className={styles.board}>
    <header className={styles.header}>
      <h1 title={title}>{title}</h1>
      <BuildChip build={build} />
    </header>
    <main className={styles.content} aria-label="Review board">
      <Empty className={styles.empty}><EmptyDescription role="status">{children}</EmptyDescription></Empty>
    </main>
  </div>;
}

function BoardCanvas({ board, build, frameSource, narrow }: {
  board: ReviewBoard;
  build: ReviewBuild;
  frameSource: FrameSource;
  narrow: boolean;
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
  const [full, setFull] = useState(false);
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
  const fullButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
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
  const interactingPosition = positions.find((position) => position.id === interacting);
  const dialogOpen = full && selectedPosition !== undefined;
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
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
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
  const fitAll = () => fit({ x: 0, y: 0, ...geometry.size });
  const moveCamera = useCallback((updater: (old: Camera) => Camera) => {
    setTransition(false);
    setCamera(updater);
  }, []);
  const zoom = (factor: number) =>
    moveCamera((old) => zoomAt(old, { x: viewport.width / 2, y: viewport.height / 2 }, factor));
  const select = (id: string, variant?: string) => {
    const hasBefore = allFrames.some(({ frame }) => frame.id === id && frame.before);
    if (!hasBefore && side !== "after") setSide("after");
    const before = hasBefore && side === "both" && variant === `${id}:before`;
    setSelected(id);
    setFull(false);
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
  const openOverlay = (open: (value: boolean) => void) => {
    if (!paletteOpen && !helpOpen && document.activeElement instanceof HTMLElement)
      setOverlayReturn(document.activeElement);
    open(true);
  };
  const overlayChange = (change: (next: boolean) => void) => (next: boolean) => {
    change(next);
    if (!next) requestAnimationFrame(() => {
      if (overlayReturn && !overlayReturn.isConnected) focusFallback?.focus({ preventScroll: true });
    });
  };
  const commands = boardCommands({
    fitBoard: fitAll,
    fitSelection: () => fit(selectedPosition.rect),
    zoom,
    zoomReset: () => zoom(1 / camera.zoom),
    pan: (x, y) => moveCamera((old) => pan(old, { x, y })),
    toggleOutline: () => {
      if (outlineOpen && overlayReturn?.closest('[aria-label="Outline"]')) {
        setOverlayReturn(focusFallback);
        setTimeout(() => focusFallback?.focus({ preventScroll: true }), 0);
      }
      setOutlineOpen((old) => !old);
    },
    toggleInspector: () => {
      if (inspectorOpen && overlayReturn?.closest('[aria-label="Inspector"]')) {
        setOverlayReturn(focusFallback);
        setTimeout(() => focusFallback?.focus({ preventScroll: true }), 0);
      }
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
  const paletteItems: PaletteItem[] = [
    ...commands.filter((command) => command.run && command.palette !== false && command.enabled !== false)
      .map((command) => ({ id: command.id, label: command.label, detail: command.group, keys: command.keys,
        run: () => command.run?.() })),
    ...geometry.sections.flatMap((section) => section.frames.map((position) => ({
      id: `frame:${position.id}`, label: frameLabel(position), detail: section.title,
      run: () => selectAndFit(position.id),
    }))),
  ];
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
  const keysActive = !mobile && !full && !interacting && !paletteOpen && !helpOpen;
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
    <header className={styles.header} inert={dialogOpen}>
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
            <option value="before">Before</option>
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
    {(mismatch || staleFrame) && <div className={styles.banner} role="status" inert={dialogOpen}>
      {mismatch && <>Opened from a comment on revision {original.rev?.slice(0, 7)}; this is {revision.slice(0, 7)}. </>}
      {staleFrame && <>Frame “{staleFrame}” is not on this revision; showing the first frame.</>}
      {mismatch && originalLink && <a href={originalLink}>Open original deployment</a>}
    </div>}
    <main ref={setContainer} className={styles.content} tabIndex={-1} aria-label="Review board" inert={dialogOpen}>
      {mobile ? <MobileReview
        board={board} current={current} position={selectedPosition} index={currentIndex}
        metric={metrics.frames.find((entry) => entry.id === selectedPosition.id)}
        loaded={loaded.has(selectedPosition.id)}
        frameSource={frameSource} fullButton={fullButton} onSelect={select} onSide={changeSide}
        onOpen={() => setFull(true)} onMark={mark} onFinish={finish} onCancel={cancel}
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
          {interactingPosition && <Badge className={styles.interactChip} role="status">
            Interacting with <strong>{frameLabel(interactingPosition)}</strong> · <Kbd>Esc</Kbd> to exit
          </Badge>}
        </div>
        {inspectorOpen && <Inspector section={selectedSection} position={selectedPosition}
          onInteract={() => interact(selectedPosition)} canInteract={canInteract}
          onFit={() => fit(selectedPosition.rect)}
          shortcuts={commands.filter((command) => command.featured)} onShowShortcuts={() => openOverlay(setHelpOpen)} />}
      </div>}
    </main>
    {!mobile && <>
      <CommandPalette open={paletteOpen} onOpenChange={overlayChange(setPaletteOpen)} items={paletteItems}
        returnFocus={overlayReturn?.isConnected ? overlayReturn : focusFallback} />
      <ShortcutsHelp open={helpOpen} onOpenChange={overlayChange(setHelpOpen)} commands={commands}
        returnFocus={overlayReturn?.isConnected ? overlayReturn : focusFallback} />
    </>}
    {dialogOpen && <div className={styles.fullscreen} role="dialog" aria-modal="true"
      aria-label={`${selectedPosition.frame.label} full width`}>
      <span tabIndex={0} className={styles.focusSentinel} onFocus={() => activeFrame.current?.focus()} />
      <div className={styles.fullscreenBar}><strong>{selectedPosition.frame.label}</strong>
        <Button ref={closeButton} variant="outline" size="touch" aria-label="Close full width" onClick={leave}>
          Close
        </Button></div>
      <iframe ref={activeFrame} title={`${selectedPosition.frame.label} full width`}
        src={frameSource === "blank" ? "about:blank" : storyCanvasUrl(selectedPosition.story)}
        onLoad={() => setActiveFrameReady((old) => old + 1)} />
      <span tabIndex={0} className={styles.focusSentinel} onFocus={() => closeButton.current?.focus()} />
    </div>}
  </div>;
}
