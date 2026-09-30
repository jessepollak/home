import { Component, useEffect, useId, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { propControls, storyArgs } from "./controls";
import { escapesLibrary, type FrameReason } from "./isolation";
import { FrameSection } from "./preview";
import { createFrameSlots, fittedFrameHeight, FRAME_MIN_HEIGHT, FRAME_WIDTH, type FrameSlots } from "./sheet-state";
import type { SheetStory } from "./stories";
import styles from "./library.module.css";

const PROBE_FRAMES = 3;
const verdicts = new Map<string, boolean>();

type Probe = { current: string | null; escaped: (id: string) => boolean | undefined };

function useEscapeProbe(root: HTMLElement | null, candidates: string[]): Probe {
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  const probing = useRef<string | null>(null);
  const interacted = useRef<string | null>(null);
  const observer = useRef<{ observer: MutationObserver; handle: (records: MutationRecord[]) => void } | null>(null);
  const current = candidates.find((id) => !verdicts.has(id)) ?? null;
  useEffect(() => {
    if (!root) return;
    const handle = (records: MutationRecord[]) => {
      let changed = false;
      for (const record of records) {
        for (const node of record.addedNodes) {
          const owner = probing.current ?? interacted.current;
          if (!owner || verdicts.get(owner) || !escapesLibrary(node, root)) continue;
          verdicts.set(owner, true);
          changed = true;
        }
      }
      if (changed) refresh();
    };
    const watcher = new MutationObserver(handle);
    watcher.observe(root.ownerDocument.body, { childList: true });
    observer.current = { observer: watcher, handle };
    const interact = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      interacted.current = target && root.contains(target)
        ? target.closest("[data-library-section]")?.getAttribute("data-library-section") ?? null : null;
    };
    const doc = root.ownerDocument;
    doc.addEventListener("pointerdown", interact, true);
    doc.addEventListener("keydown", interact, true);
    return () => {
      watcher.disconnect();
      observer.current = null;
      doc.removeEventListener("pointerdown", interact, true);
      doc.removeEventListener("keydown", interact, true);
    };
  }, [root]);
  useEffect(() => {
    if (!current || !root) return;
    probing.current = current;
    let frames = 0;
    let animation = 0;
    const step = () => {
      if (++frames < PROBE_FRAMES) { animation = requestAnimationFrame(step); return; }
      const active = observer.current;
      if (active) active.handle(active.observer.takeRecords());
      probing.current = null;
      if (!verdicts.has(current)) verdicts.set(current, false);
      refresh();
    };
    animation = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(animation);
      probing.current = null;
    };
  }, [current, root]);
  return { current, escaped: (id) => verdicts.get(id) };
}

const USER_SCROLL_WINDOW = 1000;

function useFrameScrollGuard(root: HTMLElement | null, busy: { current: Set<string> }) {
  useEffect(() => {
    if (!root) return;
    const doc = root.ownerDocument;
    let allowed = root.scrollTop;
    let userUntil = 0;
    const user = () => { userUntil = performance.now() + USER_SCROLL_WINDOW; };
    const scroll = () => {
      if (performance.now() < userUntil || !busy.current.size) allowed = root.scrollTop;
      else if (root.scrollTop !== allowed) root.scrollTop = allowed;
    };
    const rootEvents = ["wheel", "touchstart", "pointerdown"] as const;
    for (const name of rootEvents) root.addEventListener(name, user, { passive: true });
    doc.addEventListener("keydown", user, true);
    root.addEventListener("scroll", scroll);
    return () => {
      for (const name of rootEvents) root.removeEventListener(name, user);
      doc.removeEventListener("keydown", user, true);
      root.removeEventListener("scroll", scroll);
    };
  }, [root, busy]);
}

class SectionBoundary extends Component<{ story: string; children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  render() {
    if (this.state.error !== null) {
      return <p className={styles.sectionMessage} role="alert">{this.state.error || `Story failed to render: ${this.props.story}`}</p>;
    }
    return this.props.children;
  }
}

function QueuedFrame({ slots, busy, story, component, changed, theme, args, annotating, frameSource, onExitAnnotate }: {
  slots: FrameSlots;
  busy: { current: Set<string> };
  story: SheetStory;
  component: string;
  changed: boolean;
  theme: string;
  args: Record<string, unknown>;
  annotating: boolean;
  frameSource: "story" | "blank";
  onExitAnnotate: () => void;
}) {
  const [granted, setGranted] = useState(false);
  const release = useRef<(() => void) | null>(null);
  useEffect(() => {
    const frames = busy.current;
    frames.add(story.id);
    const cancel = slots.request(story.id, () => setGranted(true));
    release.current = () => {
      frames.delete(story.id);
      cancel();
    };
    return release.current;
  }, [slots, busy, story.id]);
  const [height, setHeight] = useState(FRAME_MIN_HEIGHT);
  const viewport = useMemo(() => ({ width: FRAME_WIDTH, height }), [height]);
  const target = useMemo(() => ({ story: story.id, component, label: story.name, changed }),
    [story.id, story.name, component, changed]);
  const measure = (frame: HTMLIFrameElement) => {
    try {
      const doc = frame.contentDocument;
      const content = doc?.getElementById("storybook-root");
      if (!doc || !content) return;
      const portals = [...doc.body.children].some((child) => child !== content && !content.contains(child) &&
        child.id !== "storybook-docs" && !child.classList.contains("sb-wrapper") && child.getBoundingClientRect().height > 0);
      setHeight(fittedFrameHeight(content.scrollHeight, portals || story.layout === "fullscreen"));
    } catch {
      setHeight(fittedFrameHeight(Number.NaN, true));
    }
  };
  if (!granted) {
    return <div className={styles.framePending} style={{ height }} role="status">
      Queued {story.name}…
    </div>;
  }
  return <FrameSection target={target} theme={story.pinnedTheme ?? theme} args={args} annotating={annotating}
    frameSource={frameSource} viewport={viewport} onSettled={() => release.current?.()} onRendered={measure}
    onExitAnnotate={onExitAnnotate} />;
}

export function VariantSheet({ root, component, changed, stories, theme, focused, focusedArgs, annotating, frameSource,
  onToggle, onActivate, onExitAnnotate }: {
  root: HTMLElement | null;
  component: string;
  changed: boolean;
  stories: SheetStory[];
  theme: string;
  focused: string | null;
  focusedArgs: Record<string, unknown> | null;
  annotating: boolean;
  frameSource: "story" | "blank";
  onToggle: (story: string) => void;
  onActivate: (story: string) => void;
  onExitAnnotate: () => void;
}) {
  const id = useId();
  const slots = useMemo(() => createFrameSlots(3), []);
  const inDocument = useMemo(() => stories.filter((story) => !story.frame).map((story) => story.id), [stories]);
  const probe = useEscapeProbe(root, inDocument);
  const busy = useRef(new Set<string>());
  useFrameScrollGuard(root, busy);
  const initialArgs = useMemo(() => new Map(stories.map((story) =>
    [story.id, storyArgs(propControls(story.argTypes, story.initialArgs), story.initialArgs, {})])), [stories]);
  const pendingFrom = probe.current ? inDocument.indexOf(probe.current) : -1;
  return <>{stories.map((story) => {
    const escaped = probe.escaped(story.id);
    const reason: FrameReason | null = story.frame ?? (escaped ? "Portals outside the sheet" : null);
    const pending = !reason && escaped === undefined && story.id !== probe.current &&
      pendingFrom >= 0 && inDocument.indexOf(story.id) > pendingFrom;
    const isFocused = focused === story.id;
    const args = isFocused && focusedArgs ? focusedArgs : initialArgs.get(story.id) ?? {};
    const heading = `${id}-${story.id}`;
    return <section key={story.id} className={styles.section} aria-labelledby={heading}
      data-library-section={story.id} data-focused={isFocused || undefined}
      data-review-frame={story.id} data-review-story={story.id}>
      <h2 className={styles.sectionHeading} inert={annotating || undefined}>
        <button type="button" id={heading} className={styles.sectionToggle} aria-pressed={isFocused}
          onClick={() => onToggle(story.id)}>{story.name}</button>
        {reason && <span className={styles.sectionNote}>{reason}</span>}
      </h2>
      {reason ? <QueuedFrame slots={slots} busy={busy} story={story} component={component} changed={changed} theme={theme}
        args={args} annotating={annotating} frameSource={frameSource} onExitAnnotate={onExitAnnotate} /> :
        pending ? <div className={styles.sectionPending} aria-hidden="true" /> :
          <div className={styles.sectionBody} data-layout={story.layout} data-library-story=""
            inert={annotating || undefined}
            onPointerDown={() => onActivate(story.id)} onFocus={() => onActivate(story.id)}>
            <SectionBoundary story={story.id}>
              <story.Story {...(isFocused && focusedArgs ? focusedArgs : {})} />
            </SectionBoundary>
          </div>}
      {annotating && !reason && <div role="button" tabIndex={0} className={styles.sectionOverlay}
        aria-label={`${component} · ${story.name}`}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onExitAnnotate(); } }} />}
    </section>;
  })}</>;
}
