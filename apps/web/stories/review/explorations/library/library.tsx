import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MessageSquarePlusIcon } from "lucide-react";
import { AGENTATION_ENDPOINT, shouldRenderAgentation } from "@/client/observability/agentation-gate";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Toggle } from "@/components/ui/toggle";
import { viewports } from "../board/manifest";
import type { ReviewBuild, StoryIndexEntry } from "../board/review-build";
import { writeBoardUrl } from "../board/url-state";
import { libraryCatalog, type LibraryCatalog } from "./catalog";
import { propControls, storyArgs, type PropValue } from "./controls";
import { LibraryPreview, type PreparedPreview } from "./preview";
import { PropsBar } from "./props-bar";
import { LibrarySidebar } from "./sidebar";
import { readLibraryUrl, writeLibraryUrl } from "./url-state";
import styles from "./library.module.css";

type StoryIndex = Record<string, StoryIndexEntry>;

const Agentation = lazy(() => import("agentation").then((module) => ({ default: module.Agentation })));

const STAGE_PADDING = 48;
const CAPTION_SPACE = 28;

export function LibraryView({ build, theme = "light", storyIndex, frameSource = "story" }: {
  build: ReviewBuild;
  theme?: string;
  storyIndex?: StoryIndex;
  frameSource?: "story" | "blank";
}) {
  const [index, setIndex] = useState<StoryIndex | "unavailable" | undefined>(storyIndex);
  useEffect(() => {
    if (storyIndex) return;
    const abort = new AbortController();
    fetch("./index.json", { signal: abort.signal }).then((response) => {
      if (!response.ok) throw new Error("Story index unavailable");
      return response.json() as Promise<{ entries: StoryIndex }>;
    }).then((data) => setIndex(data.entries)).catch(() => {
      if (!abort.signal.aborted) setIndex("unavailable");
    });
    return () => abort.abort();
  }, [storyIndex]);
  const catalog = useMemo(() => typeof index === "object" ? libraryCatalog(index, build) : null, [index, build]);
  if (index === undefined) return <LibraryMessage>Loading library…</LibraryMessage>;
  if (!catalog) return <LibraryMessage>Couldn&apos;t load this build&apos;s story list. Reload to try again.</LibraryMessage>;
  if (!catalog.items.length) return <LibraryMessage>No owned components are in this build.</LibraryMessage>;
  return <LibraryWorkspace catalog={catalog} build={build} theme={theme} frameSource={frameSource} />;
}

function LibraryMessage({ children }: { children: string }) {
  return <div className={styles.library} data-review-library="message">
    <main className={styles.surface} aria-label="Library">
      <Empty><EmptyDescription role="status">{children}</EmptyDescription></Empty>
    </main>
  </div>;
}

function useStageScale() {
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    if (!stage) return;
    const { width, height } = viewports.mobile;
    const update = () => {
      const bounds = stage.getBoundingClientRect();
      setScale(Math.max(0.25, Math.min(1, (bounds.width - STAGE_PADDING) / width, (bounds.height - STAGE_PADDING - CAPTION_SPACE) / height)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stage]);
  return { setStage, scale };
}

function LibraryWorkspace({ catalog, build, theme, frameSource }: {
  catalog: LibraryCatalog;
  build: ReviewBuild;
  theme: string;
  frameSource: "story" | "blank";
}) {
  const original = useMemo(() => readLibraryUrl(new URL(location.href)), []);
  const linked = catalog.items.some((item) => item.id === original.component) ? original.component : undefined;
  const [selected, setSelected] = useState(linked ?? catalog.items[0].id);
  const [overrides, setOverrides] = useState<Record<string, PropValue>>(linked ? original.props : {});
  const [prepared, setPrepared] = useState<{ story: string; value: PreparedPreview } | null>(null);
  const [annotating, setAnnotating] = useState(false);
  const { setStage, scale } = useStageScale();
  const item = catalog.items.find((entry) => entry.id === selected) ?? catalog.items[0];
  const current = prepared?.story === item.story ? prepared.value : null;
  const controls = useMemo(() => current ? propControls(current.argTypes, current.initialArgs) : null, [current]);
  const args = useMemo(() => current && controls ? storyArgs(controls, current.initialArgs, overrides) : null,
    [current, controls, overrides]);
  const overridesRef = useRef(overrides);
  useLayoutEffect(() => { overridesRef.current = overrides; });
  const updateUrl = useCallback((component: string, props: Record<string, PropValue>) => {
    history.replaceState(history.state, "", writeLibraryUrl(new URL(location.href), { component, props }));
  }, []);
  useEffect(() => {
    history.replaceState(history.state, "", writeBoardUrl(new URL(location.href),
      { rev: build.revision, deployment: build.deployment || undefined }));
  }, [build.revision, build.deployment]);
  useEffect(() => { updateUrl(item.id, overrides); }, [item.id, overrides, updateUrl]);
  const select = (id: string) => {
    if (id === selected) return;
    setSelected(id);
    setOverrides({});
  };
  const onPrepared = useCallback((value: PreparedPreview) => {
    setPrepared({ story: item.story, value });
    return storyArgs(propControls(value.argTypes, value.initialArgs), value.initialArgs, overridesRef.current);
  }, [item.story]);
  const change = (name: string, value: PropValue | undefined) => setOverrides((currentOverrides) => {
    const rest = Object.fromEntries(Object.entries(currentOverrides).filter(([key]) => key !== name));
    return value === undefined || value === current?.initialArgs[name] ? rest : { ...rest, [name]: value };
  });
  return <div className={styles.library} data-review-library="workspace">
    <LibrarySidebar catalog={catalog} selected={item.id} onSelect={select} />
    <main className={styles.surface} aria-label={`${item.name} preview`}>
      <PropsBar name={item.name} controls={controls} values={args ?? {}} onChange={change} />
      <div ref={setStage} className={styles.stage}>
        <figure className={styles.figure}>
          <LibraryPreview key={item.story} item={item} theme={theme} args={args} annotating={annotating}
            frameSource={frameSource} scale={scale} onPrepared={onPrepared} onExitAnnotate={() => setAnnotating(false)} />
          <figcaption className={styles.caption}>
            {item.name} · {item.storyName} · {viewports.mobile.width} × {viewports.mobile.height}
          </figcaption>
        </figure>
      </div>
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
