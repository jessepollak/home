import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MessageSquarePlusIcon } from "lucide-react";
import { AGENTATION_ENDPOINT, shouldRenderAgentation } from "@/client/observability/agentation-gate";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { viewports } from "../board/manifest";
import { startRenderDeadline } from "../board/render-deadline";
import type { ReviewBuild, StoryIndexEntry } from "../board/review-build";
import { writeBoardUrl } from "../board/url-state";
import { libraryCatalog, type LibraryCatalog } from "./catalog";
import { propControls, storyArgs, type PropValue } from "./controls";
import { PropsBar } from "./props-bar";
import { VariantSheet } from "./sheet";
import { restoredFocus, toggleFocus } from "./sheet-state";
import { LibrarySidebar } from "./sidebar";
import { loadStoryModule, peekStoryModule, sheetStories, type StoryModule } from "./stories";
import { loadLibraryIndex } from "./story-index";
import { readLibraryUrl, writeLibraryUrl } from "./url-state";
import styles from "./library.module.css";

type StoryIndex = Record<string, StoryIndexEntry>;

const Agentation = lazy(() => import("agentation").then((module) => ({ default: module.Agentation })));

export function LibraryView({ build, theme = "light", storyIndex, frameSource = "story" }: {
  build: ReviewBuild;
  theme?: string;
  storyIndex?: StoryIndex;
  frameSource?: "story" | "blank";
}) {
  const [index, setIndex] = useState<StoryIndex | "unavailable" | undefined>(storyIndex);
  useEffect(() => {
    if (storyIndex) return;
    return loadLibraryIndex(setIndex);
  }, [storyIndex]);
  const catalog = useMemo(() => typeof index === "object" ? libraryCatalog(index, build) : null, [index, build]);
  if (index === undefined) return <LibraryMessage>Loading library…</LibraryMessage>;
  if (!catalog) return <LibraryMessage>Couldn&apos;t load this build&apos;s story list. Reload to try again.</LibraryMessage>;
  if (!catalog.items.length) return <LibraryMessage>No owned components are in this build.</LibraryMessage>;
  return <LibraryWorkspace catalog={catalog} index={index as StoryIndex} build={build} theme={theme}
    frameSource={frameSource} />;
}

function LibraryMessage({ children }: { children: string }) {
  return <div className={styles.library} data-review-library="message">
    <main className={styles.surface} aria-label="Library">
      <Empty><EmptyDescription role="status">{children}</EmptyDescription></Empty>
    </main>
  </div>;
}

function useStoryModule(importPath: string | undefined) {
  const [state, setState] = useState<{ path: string; module?: StoryModule; failed?: boolean } | null>(null);
  const cached = importPath ? peekStoryModule(importPath) : undefined;
  useEffect(() => {
    if (!importPath || peekStoryModule(importPath)) return;
    let live = true;
    const stop = startRenderDeadline(() => { if (live) setState({ path: importPath, failed: true }); });
    loadStoryModule(importPath).then((module) => {
      if (live) setState({ path: importPath, module });
    }, () => {
      if (live) setState({ path: importPath, failed: true });
    }).finally(stop);
    return () => {
      live = false;
      stop();
    };
  }, [importPath]);
  const current = state?.path === importPath ? state : null;
  return { module: cached ?? current?.module, failed: !cached && current?.failed === true };
}

function componentStories(index: StoryIndex, title: string): StoryIndexEntry[] {
  return Object.values(index).filter((entry) => entry.type === "story" && entry.title === title);
}

function LibraryWorkspace({ catalog, index, build, theme: toolbarTheme, frameSource }: {
  catalog: LibraryCatalog;
  index: StoryIndex;
  build: ReviewBuild;
  theme: string;
  frameSource: "story" | "blank";
}) {
  const original = useMemo(() => readLibraryUrl(new URL(location.href)), []);
  const linked = catalog.items.some((item) => item.id === original.component) ? original.component : undefined;
  const [selected, setSelected] = useState(linked ?? catalog.items[0].id);
  const [focus, setFocus] = useState<string | null>(linked ? original.story ?? null : null);
  const [overrides, setOverrides] = useState<Record<string, PropValue>>(linked && original.story ? original.props : {});
  const [picked, setPicked] = useState({ source: toolbarTheme, value: toolbarTheme });
  const theme = picked.source === toolbarTheme ? picked.value : toolbarTheme;
  const [annotating, setAnnotating] = useState(false);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const attach = useCallback((node: HTMLDivElement | null) => {
    scroller.current = node;
    setRoot(node);
  }, []);
  const position = Math.max(0, catalog.items.findIndex((entry) => entry.id === selected));
  const item = catalog.items[position];
  const entries = useMemo(() => componentStories(index, item.title), [index, item.title]);
  const { module, failed } = useStoryModule(entries[0]?.importPath);
  const stories = useMemo(() => module ? sheetStories(module, entries, theme) : null, [module, entries, theme]);
  const focused = stories ? restoredFocus(focus ?? undefined, stories.map((story) => story.id)) : focus;
  const focusedStory = stories?.find((story) => story.id === focused);
  const controls = useMemo(() => focusedStory ? propControls(focusedStory.argTypes, focusedStory.initialArgs) : null,
    [focusedStory]);
  const args = useMemo(() => focusedStory && controls ? storyArgs(controls, focusedStory.initialArgs, overrides) : null,
    [focusedStory, controls, overrides]);
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [item.id]);
  useEffect(() => {
    history.replaceState(history.state, "", writeBoardUrl(new URL(location.href),
      { rev: build.revision, deployment: build.deployment || undefined }));
  }, [build.revision, build.deployment]);
  useEffect(() => {
    history.replaceState(history.state, "", writeLibraryUrl(new URL(location.href),
      { component: item.id, story: focused ?? undefined, props: focused ? overrides : {} }));
  }, [item.id, focused, overrides]);
  useEffect(() => {
    for (const neighbour of [catalog.items[position - 1], catalog.items[position + 1]]) {
      const path = neighbour && componentStories(index, neighbour.title)[0]?.importPath;
      if (path) loadStoryModule(path).catch(() => undefined);
    }
  }, [catalog.items, index, position]);
  const clearFocus = useCallback(() => {
    setFocus(null);
    setOverrides({});
  }, []);
  useEffect(() => {
    if (!focused || annotating) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) clearFocus();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [focused, annotating, clearFocus]);
  const select = (id: string) => {
    if (id === selected) return;
    setSelected(id);
    clearFocus();
  };
  const toggle = (story: string) => {
    setFocus(toggleFocus(focused, story));
    setOverrides({});
  };
  const activate = (story: string) => {
    if (story !== focused) toggle(story);
  };
  const change = (name: string, value: PropValue | undefined) => setOverrides((currentOverrides) => {
    const rest = Object.fromEntries(Object.entries(currentOverrides).filter(([key]) => key !== name));
    return value === undefined || value === focusedStory?.initialArgs[name] ? rest : { ...rest, [name]: value };
  });
  const count = entries.length === 1 ? "1 story" : `${entries.length} stories`;
  return <div className={styles.library} data-review-library="workspace">
    <LibrarySidebar catalog={catalog} selected={item.id} onSelect={select} />
    <main className={styles.surface} aria-label={`${item.name} preview`}>
      <header className={styles.toolbar}>
        <div className={styles.pickers}>
          <span id="library-theme-label" className={styles.pickerLabel}>Theme</span>
          <ToggleGroup variant="outline" spacing={0} aria-labelledby="library-theme-label" value={[theme]}
            onValueChange={(value) => { if (value[0]) setPicked({ source: toolbarTheme, value: value[0] }); }}>
            <ToggleGroupItem value="light">Light</ToggleGroupItem>
            <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
          </ToggleGroup>
        </div>
        {focusedStory && controls && args &&
          <PropsBar name={`${item.name} · ${focusedStory.name}`} controls={controls} values={args} onChange={change} />}
      </header>
      <figure className={styles.stage}>
        <div ref={attach} className={styles.device} data-annotating={annotating || undefined}>
          {stories ? <VariantSheet key={item.id} root={root} component={item.name} changed={item.changed}
            stories={stories} theme={theme} focused={focused} focusedArgs={args} annotating={annotating}
            frameSource={frameSource} onToggle={toggle} onActivate={activate}
            onEscape={clearFocus} onExitAnnotate={() => setAnnotating(false)} /> :
            <p className={styles.sectionMessage} role={failed ? "alert" : "status"}>
              {failed ? `Couldn't load ${item.name}'s stories. Reload to try again.` : `Loading ${item.name}…`}
            </p>}
        </div>
        <figcaption className={styles.caption}>{item.name} · {count} · {viewports.mobile.width} wide</figcaption>
      </figure>
      <AnnotateToggle annotating={annotating} onChange={setAnnotating} />
    </main>
  </div>;
}

function AnnotateToggle({ annotating, onChange }: { annotating: boolean; onChange: (value: boolean) => void }) {
  const agentation = shouldRenderAgentation(import.meta.env.MODE);
  return <>
    <Toggle variant="outline" size="lg" className={styles.annotate} aria-label="Annotate"
      data-agentation-open={annotating && agentation ? "" : undefined}
      title={annotating ? "Stop annotating" : "Annotate the preview"} pressed={annotating} onPressedChange={onChange}>
      <MessageSquarePlusIcon aria-hidden="true" />
    </Toggle>
    {annotating && agentation && <Suspense fallback={null}><Agentation endpoint={AGENTATION_ENDPOINT} /></Suspense>}
  </>;
}
