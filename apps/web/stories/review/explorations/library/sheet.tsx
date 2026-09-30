import { Component, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { propControls, storyArgs } from "./controls";
import { FrameSection } from "./preview";
import { createFrameSlots, fittedFrameHeight, FRAME_MAX_HEIGHT, FRAME_MIN_HEIGHT, FRAME_WIDTH, scaledViewport, type FrameSlots } from "./sheet-state";
import { storyCanvasUrl } from "../board/url-state";
import type { SheetStory } from "./stories";
import styles from "./library.module.css";


const USER_SCROLL_WINDOW = 1000;

function useFrameScrollGuard(root: HTMLElement | null, busy: { current: Set<string> }) {
  const userUntil = useRef(0);
  const user = useCallback(() => { userUntil.current = performance.now() + USER_SCROLL_WINDOW; }, []);
  useEffect(() => {
    if (!root) return;
    const doc = root.ownerDocument;
    let allowed = root.scrollTop;
    const scroll = () => {
      if (performance.now() < userUntil.current || !busy.current.size) allowed = root.scrollTop;
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
  }, [root, busy, user]);
  return user;
}

type SectionInputs = { Story: SheetStory["Story"]; theme: string; args: Record<string, unknown> | null };

class SectionBoundary extends Component<SectionInputs & { story: string; children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  componentDidUpdate(previous: SectionInputs) {
    if (this.state.error !== null && (previous.Story !== this.props.Story || previous.theme !== this.props.theme ||
      JSON.stringify(previous.args) !== JSON.stringify(this.props.args))) this.setState({ error: null });
  }
  render() {
    if (this.state.error !== null) {
      return <p className={styles.sectionMessage} role="alert">{this.state.error || `Story failed to render: ${this.props.story}`}</p>;
    }
    return this.props.children;
  }
}

function QueuedFrame({ root, slots, busy, story, component, changed, theme, args, annotating, frameSource, onUserInput, onEscape, onExitAnnotate }: {
  root: HTMLElement | null;
  slots: FrameSlots;
  busy: { current: Set<string> };
  story: SheetStory;
  component: string;
  changed: boolean;
  theme: string;
  args: Record<string, unknown>;
  annotating: boolean;
  frameSource: "story" | "blank";
  onUserInput: () => void;
  onEscape: () => void;
  onExitAnnotate: () => void;
}) {
  const [granted, setGranted] = useState(false);
  const release = useRef<(() => void) | null>(null);
  const [nearby, setNearby] = useState(() => typeof IntersectionObserver === "undefined");
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (nearby) return;
    const node = container.current;
    if (!node) return;
    const view = node.ownerDocument.defaultView!;
    let observer: IntersectionObserver;
    const observe = () => {
      observer?.disconnect();
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNearby(true);
      }, { root, rootMargin: `${root?.clientHeight || view.innerHeight}px 0px`, threshold: 0 });
      observer.observe(node);
    };
    observe();
    const resize = new ResizeObserver(observe);
    resize.observe(root ?? node.ownerDocument.documentElement);
    view.addEventListener("resize", observe);
    return () => { observer.disconnect(); resize.disconnect(); view.removeEventListener("resize", observe); };
  }, [nearby, root]);
  useEffect(() => {
    if (visible) return;
    const node = container.current;
    if (!node) return;
    const view = node.ownerDocument.defaultView!;
    let observer: IntersectionObserver;
    const observe = () => {
      observer?.disconnect();
      const height = node.getBoundingClientRect().height;
      const tallThreshold = height > 0 ? Math.min(0.5, view.innerHeight / (2 * height)) : 0.5;
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting && (entry.intersectionRatio >= 0.5 ||
          entry.intersectionRect.height >= view.innerHeight / 2))) setVisible(true);
      }, { root, threshold: [0, tallThreshold, 0.5] });
      observer.observe(node);
    };
    observe();
    const resize = new ResizeObserver(observe);
    resize.observe(node);
    view.addEventListener("resize", observe);
    return () => { observer.disconnect(); resize.disconnect(); view.removeEventListener("resize", observe); };
  }, [visible, root]);
  useEffect(() => {
    if (!nearby) return;
    const frames = busy.current;
    frames.add(story.id);
    const cancel = slots.request(story.id, () => setGranted(true));
    release.current = () => {
      frames.delete(story.id);
      cancel();
    };
    return release.current;
  }, [slots, busy, story.id, nearby]);
  const fullHeight = story.portals || story.layout === "fullscreen";
  const [height, setHeight] = useState(FRAME_MIN_HEIGHT);
  const [available, setAvailable] = useState(FRAME_WIDTH);
  useLayoutEffect(() => {
    const node = container.current;
    if (!story.viewport || !node) return;
    const measure = () => setAvailable(node.clientWidth || FRAME_WIDTH);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [story.viewport]);
  const viewport = useMemo(() => story.viewport ?? { width: FRAME_WIDTH, height: fullHeight ? FRAME_MAX_HEIGHT : height },
    [story.viewport, fullHeight, height]);
  const fitted = scaledViewport(viewport, available);
  const target = useMemo(() => ({ story: story.id, component, label: story.name, changed }),
    [story.id, story.name, component, changed]);
  const measure = (frame: HTMLIFrameElement) => {
    if (fullHeight || story.viewport) return;
    try {
      const doc = frame.contentDocument;
      const content = doc?.getElementById("storybook-root");
      if (!doc || !content) return;
      setHeight(fittedFrameHeight(content.scrollHeight, false));
    } catch {
      setHeight(fittedFrameHeight(Number.NaN, true));
    }
  };
  return <div ref={container}>
    {!granted ? <div className={styles.framePending} style={{ height: fitted.height }} role="status">
      Queued {story.name}…
    </div> : <FrameSection target={target} theme={theme} args={args} annotating={annotating}
      frameSource={frameSource} viewport={viewport} scale={fitted.scale} onSettled={() => release.current?.()} onRendered={measure}
      visible={visible} onUserInput={onUserInput} onEscape={onEscape} onExitAnnotate={onExitAnnotate} />}
    {story.viewport && <p className={styles.viewportCaption}>
      <a href={storyCanvasUrl(story.id)} target="_blank" rel="noreferrer">
        {viewport.width} × {viewport.height}{fitted.scale < 1 ? " · scaled" : ""}
      </a>
    </p>}
  </div>;
}

export function VariantSheet({ root, component, changed, stories, hiddenThemes = 0, theme, focused, focusedArgs, annotating, frameSource,
  onToggle, onEscape, onExitAnnotate }: {
  root: HTMLElement | null;
  component: string;
  changed: boolean;
  stories: SheetStory[];
  hiddenThemes?: number;
  theme: string;
  focused: string | null;
  focusedArgs: Record<string, unknown> | null;
  annotating: boolean;
  frameSource: "story" | "blank";
  onToggle: (story: string) => void;
  onEscape: () => void;
  onExitAnnotate: () => void;
}) {
  const id = useId();
  const slots = useMemo(() => createFrameSlots(3), []);
  const busy = useRef(new Set<string>());
  const onUserInput = useFrameScrollGuard(root, busy);
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (!root || restored.current) return;
    restored.current = true;
    if (focused) {
      const section = [...root.querySelectorAll<HTMLElement>("[data-library-section]")]
        .find((node) => node.dataset.librarySection === focused);
      section?.scrollIntoView({ block: "start", behavior: "instant" });
    }
  }, [root, focused]);
  const initialArgs = useMemo(() => new Map(stories.map((story) =>
    [story.id, storyArgs(propControls(story.argTypes, story.initialArgs), story.initialArgs, {})])), [stories]);
  return <>{stories.map((story) => {
    const reason = story.frame;
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
      {reason ? <QueuedFrame root={root} slots={slots} busy={busy} story={story} component={component} changed={changed} theme={theme}
        args={args} annotating={annotating} frameSource={frameSource} onUserInput={onUserInput}
        onEscape={onEscape} onExitAnnotate={onExitAnnotate} /> :
          <div className={styles.sectionBody} data-layout={story.layout} data-library-story=""
            inert={annotating || undefined}>
            <SectionBoundary story={story.id} Story={story.Story} theme={theme} args={isFocused ? focusedArgs : null}>
              <story.Story {...(isFocused && focusedArgs ? focusedArgs : {})} />
            </SectionBoundary>
          </div>}
      {annotating && !reason && <div role="button" tabIndex={0} className={styles.sectionOverlay}
        aria-label={`${component} · ${story.name}`}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onExitAnnotate(); } }} />}
    </section>;
  })}{hiddenThemes > 0 && <p className={styles.hiddenThemes}>
    {hiddenThemes} theme-pinned {hiddenThemes === 1 ? "story" : "stories"} hidden · use Theme
  </p>}</>;
}
