import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MessageSquarePlusIcon } from "lucide-react";
import { AGENTATION_ENDPOINT, shouldRenderAgentation } from "@/client/observability/agentation-gate";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { startRenderDeadline } from "../board/render-deadline";
import type { ReviewBuild, StoryIndexEntry } from "../board/review-build";
import { writeBoardUrl } from "../board/url-state";
import { COMPOSITIONS, libraryCatalog, OVERVIEW, type LibraryCatalog } from "./catalog";
import { CompositionsSheet } from "./compositions/compositions";
import { propControls, storyArgs, type PropValue } from "./controls";
import { FoundationsSurface } from "./foundations/foundations";
import { foundationPages, isFoundation } from "./foundations/model";
import { OverviewSurface } from "./overview/overview";
import { PropsBar } from "./props-bar";
import { VariantSheet } from "./sheet";
import { restoredFocus, toggleFocus } from "./sheet-state";
import { LibrarySidebar } from "./sidebar";
import { compositionEntries, loadNotUsedInProduct, loadStoryModule, peekStoryModule, sheetStories, type StoryModule } from "./stories";
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

function restoredLibraryUrl(catalog: LibraryCatalog, compositions: readonly StoryIndexEntry[]) {
  const state = readLibraryUrl(new URL(location.href));
  const component = catalog.items.some((item) => item.id === state.component);
  const composition = state.component === COMPOSITIONS;
  return {
    selected: component || composition || isFoundation(state.component) ? state.component! : OVERVIEW,
    focus: component ? state.story ?? null
      : composition && compositions.some((entry) => entry.id === state.story) ? state.story ?? null : null,
    overrides: component && state.story ? state.props : {},
    theme: state.theme,
  };
}

function LibraryWorkspace({ catalog, index, build, theme: toolbarTheme, frameSource }: {
  catalog: LibraryCatalog;
  index: StoryIndex;
  build: ReviewBuild;
  theme: string;
  frameSource: "story" | "blank";
}) {
  const compositions = useMemo(() => compositionEntries(index), [index]);
  const [productUsage, setProductUsage] = useState<string[] | "failed" | null>(null);
  const compositionGroups = new Set(compositions.map((entry) => entry.title)).size;
  const [original] = useState(() => restoredLibraryUrl(catalog, compositions));
  const [selected, setSelected] = useState(original.selected);
  const overview = selected === OVERVIEW;
  const composing = selected === COMPOSITIONS;
  useEffect(() => {
    if (!composing) return;
    let live = true;
    loadNotUsedInProduct().then((names) => { if (live) setProductUsage(names); }, () => { if (live) setProductUsage("failed"); });
    return () => { live = false; };
  }, [composing]);
  const foundation = isFoundation(selected) ? selected : null;
  const [focus, setFocus] = useState<string | null>(original.focus);
  const [overrides, setOverrides] = useState<Record<string, PropValue>>(original.overrides);
  const [picked, setPicked] = useState({ source: toolbarTheme, value: original.theme ?? toolbarTheme });
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
  const { module, failed } = useStoryModule(overview || composing ? undefined : entries[0]?.importPath);
  const allStories = useMemo(() => module ? sheetStories(module, entries, theme) : null, [module, entries, theme]);
  const stories = useMemo(() => allStories?.filter((story) => !story.themePinned) ?? null, [allStories]);
  const hiddenThemes = allStories ? allStories.length - (stories?.length ?? 0) : 0;
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
  const sheet = !overview && !composing && !foundation;
  useEffect(() => {
    history.replaceState(history.state, "", writeLibraryUrl(new URL(location.href), {
      component: overview ? undefined : composing ? COMPOSITIONS : foundation ?? item.id,
      story: sheet || composing ? focused ?? undefined : undefined,
      props: sheet && focused ? overrides : {}, theme: theme === "dark" ? "dark" : "light",
    }));
  }, [overview, composing, foundation, sheet, item.id, focused, overrides, theme]);
  useEffect(() => {
    const restore = () => {
      const state = restoredLibraryUrl(catalog, compositions);
      setSelected(state.selected);
      setFocus(state.focus);
      setOverrides(state.overrides);
      setPicked({ source: toolbarTheme, value: state.theme ?? toolbarTheme });
      setAnnotating(false);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [catalog, compositions, toolbarTheme]);
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
    history.pushState(history.state, "", writeLibraryUrl(new URL(location.href), {
      component: id === OVERVIEW ? undefined : id, story: undefined, props: {},
    }));
    setSelected(id);
    clearFocus();
  };
  const toggle = (story: string) => {
    setFocus(toggleFocus(focused, story));
    setOverrides({});
  };
  const preload = (id: string) => {
    const target = catalog.items.find((entry) => entry.id === id);
    const path = target && componentStories(index, target.title)[0]?.importPath;
    if (path) loadStoryModule(path).catch(() => undefined);
  };
  const change = (name: string, value: PropValue | undefined) => setOverrides((currentOverrides) => {
    const rest = Object.fromEntries(Object.entries(currentOverrides).filter(([key]) => key !== name));
    return value === undefined || value === focusedStory?.initialArgs[name] ? rest : { ...rest, [name]: value };
  });
  const count = entries.length === 1 ? "1 story" : `${entries.length} stories`;
  return <div className={styles.library} data-review-library="workspace">
    <LibrarySidebar catalog={catalog} compositions={compositionGroups}
      selected={overview || composing ? selected : foundation ?? item.id} onSelect={select} onPreload={preload} />
    <main className={styles.surface} aria-label={overview ? "Library overview" : composing ? "Library compositions" : foundation
      ? `${foundationPages.find((page) => page.id === foundation)!.name} foundations` : `${item.name} preview`}>
      <header className={styles.toolbar}>
        <div className={styles.pickers}>
          <span id="library-theme-label" className={styles.pickerLabel}>Theme</span>
          <ToggleGroup variant="outline" spacing={0} aria-labelledby="library-theme-label" value={[theme]}
            onValueChange={(value) => { if (value[0]) setPicked({ source: toolbarTheme, value: value[0] }); }}>
            <ToggleGroupItem value="light">Light</ToggleGroupItem>
            <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
          </ToggleGroup>
        </div>
        {sheet && focusedStory && controls && args &&
          <PropsBar name={`${item.name} · ${focusedStory.name}`} controls={controls} values={args} onChange={change} />}
      </header>
      {overview ? <OverviewSurface items={catalog.items} onSelect={select} />
        : composing ? <figure className={styles.stage}>
        <div ref={attach} className={styles.device} data-annotating={annotating || undefined}>
          {productUsage === "failed" && <p className={styles.unusedComponents} role="alert">
            Couldn&apos;t read product usage, so unused components can&apos;t be listed.
          </p>}
          {Array.isArray(productUsage) && productUsage.length > 0 && <p className={styles.unusedComponents}>
            Not used in any product screen: {productUsage.map((name, ordinal) => {
              const target = catalog.items.find((candidate) =>
                componentStories(index, candidate.title).some((entry) => entry.importPath.endsWith(`/ui/${name}.stories.tsx`)));
              return target ? <span key={name}>{ordinal > 0 ? ", " : ""}<a
                href={writeLibraryUrl(new URL(location.href), { component: target.id, story: undefined, props: {} }).href}
                onClick={(event) => { event.preventDefault(); select(target.id); }}>{target.name}</a></span> : null;
            })}
          </p>}
          <CompositionsSheet entries={compositions} root={root} theme={theme} focused={focused} annotating={annotating}
            frameSource={frameSource} onToggle={toggle} onEscape={clearFocus} onExitAnnotate={() => setAnnotating(false)} />
        </div>
        <figcaption className={styles.caption}>Compositions · {compositionCount(compositionGroups)}</figcaption>
      </figure>
        : foundation ? <FoundationsSurface page={foundation} theme={theme} /> : <figure className={styles.stage}>
        <div ref={attach} className={styles.device} data-annotating={annotating || undefined}>
          {stories ? <VariantSheet key={item.id} root={root} component={item.name} changed={item.changed}
            stories={stories} theme={theme} focused={focused} focusedArgs={args} annotating={annotating}
            hiddenThemes={hiddenThemes} frameSource={frameSource} onToggle={toggle}
            onEscape={clearFocus} onExitAnnotate={() => setAnnotating(false)} /> :
            <p className={styles.sectionMessage} role={failed ? "alert" : "status"}>
              {failed ? `Couldn't load ${item.name}'s stories. Reload to try again.` : `Loading ${item.name}…`}
            </p>}
        </div>
        <figcaption className={styles.caption}>{item.name} · {count}</figcaption>
      </figure>}
      {(sheet || composing) && <AnnotateToggle annotating={annotating} onChange={setAnnotating} />}
    </main>
  </div>;
}

function compositionCount(count: number): string {
  return count === 1 ? "1 composition" : `${count} compositions`;
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
