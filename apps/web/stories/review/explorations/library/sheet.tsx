import { Component, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { propControls, storyArgs } from "./controls";
import { FrameSection } from "./preview";
import { createFrameSlots, fittedFrameHeight, FRAME_MAX_HEIGHT, FRAME_MIN_HEIGHT, FRAME_WIDTH, type FrameSlots } from "./sheet-state";
import type { SheetStory } from "./stories";
import styles from "./library.module.css";


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

function QueuedFrame({ slots, busy, story, component, changed, theme, args, annotating, frameSource, onActivate, onEscape, onExitAnnotate }: {
  slots: FrameSlots;
  busy: { current: Set<string> };
  story: SheetStory;
  component: string;
  changed: boolean;
  theme: string;
  args: Record<string, unknown>;
  annotating: boolean;
  frameSource: "story" | "blank";
  onActivate: () => void;
  onEscape: () => void;
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
  const fullHeight = story.portals || story.layout === "fullscreen";
  const [height, setHeight] = useState(FRAME_MIN_HEIGHT);
  const viewport = useMemo(() => ({ width: FRAME_WIDTH, height: fullHeight ? FRAME_MAX_HEIGHT : height }), [fullHeight, height]);
  const target = useMemo(() => ({ story: story.id, component, label: story.name, changed }),
    [story.id, story.name, component, changed]);
  const measure = (frame: HTMLIFrameElement) => {
    if (fullHeight) return;
    try {
      const doc = frame.contentDocument;
      const content = doc?.getElementById("storybook-root");
      if (!doc || !content) return;
      setHeight(fittedFrameHeight(content.scrollHeight, false));
    } catch {
      setHeight(fittedFrameHeight(Number.NaN, true));
    }
  };
  if (!granted) {
    return <div className={styles.framePending} style={{ height: viewport.height }} role="status">
      Queued {story.name}…
    </div>;
  }
  return <FrameSection target={target} theme={story.pinnedTheme ?? theme} args={args} annotating={annotating}
    frameSource={frameSource} viewport={viewport} onSettled={() => release.current?.()} onRendered={measure}
    onActivate={onActivate} onEscape={onEscape} onExitAnnotate={onExitAnnotate} />;
}

export function VariantSheet({ root, component, changed, stories, theme, focused, focusedArgs, annotating, frameSource,
  onToggle, onActivate, onEscape, onExitAnnotate }: {
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
  onEscape: () => void;
  onExitAnnotate: () => void;
}) {
  const id = useId();
  const slots = useMemo(() => createFrameSlots(3), []);
  const busy = useRef(new Set<string>());
  useFrameScrollGuard(root, busy);
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
      {reason ? <QueuedFrame slots={slots} busy={busy} story={story} component={component} changed={changed} theme={theme}
        args={args} annotating={annotating} frameSource={frameSource} onActivate={() => onActivate(story.id)}
        onEscape={onEscape} onExitAnnotate={onExitAnnotate} /> :
          <div className={styles.sectionBody} data-layout={story.layout} data-library-story=""
            inert={annotating || undefined}
            onPointerDown={() => onActivate(story.id)} onFocus={() => onActivate(story.id)}>
            <SectionBoundary story={story.id} Story={story.Story} theme={theme} args={isFocused ? focusedArgs : null}>
              <story.Story {...(isFocused && focusedArgs ? focusedArgs : {})} />
            </SectionBoundary>
          </div>}
      {annotating && !reason && <div role="button" tabIndex={0} className={styles.sectionOverlay}
        aria-label={`${component} · ${story.name}`}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onExitAnnotate(); } }} />}
    </section>;
  })}</>;
}
