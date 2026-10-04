import { useEffect, useState } from "react";
import type { StoryIndexEntry } from "../../board/review-build";
import { startRenderDeadline } from "../../board/render-deadline";
import { VariantSheet } from "../sheet";
import { loadCompositionStories, type SheetStory } from "../stories";
import styles from "../library.module.css";

export function CompositionsSheet({ entries, root, theme, focused, annotating, frameSource, onToggle, onEscape, onExitAnnotate }: {
  entries: StoryIndexEntry[];
  root: HTMLElement | null;
  theme: string;
  focused: string | null;
  annotating: boolean;
  frameSource: "story" | "blank";
  onToggle: (story: string) => void;
  onEscape: () => void;
  onExitAnnotate: () => void;
}) {
  const key = entries.map((entry) => entry.id).join("\u0000");
  const [state, setState] = useState<{ key: string; stories?: SheetStory[]; failed?: boolean } | null>(null);
  useEffect(() => {
    if (!entries.length) return;
    let live = true;
    const stop = startRenderDeadline(() => { if (live) setState({ key, failed: true }); });
    loadCompositionStories(entries).then((stories) => {
      if (live) setState({ key, stories });
    }, () => {
      if (live) setState({ key, failed: true });
    }).finally(stop);
    return () => {
      live = false;
      stop();
    };
  }, [entries, key]);
  const current = state?.key === key ? state : null;
  if (!entries.length) return <p className={styles.sectionMessage} role="status">No compositions are in this build.</p>;
  if (!current?.stories) {
    return <p className={styles.sectionMessage} role={current?.failed ? "alert" : "status"}>
      {current?.failed ? "Couldn't load the compositions. Reload to try again." : "Loading compositions…"}
    </p>;
  }
  return <VariantSheet root={root} component="Compositions" changed={false} stories={current.stories} theme={theme}
    focused={focused} focusedArgs={null} annotating={annotating} frameSource={frameSource} showReasons={false}
    onToggle={onToggle} onEscape={onEscape} onExitAnnotate={onExitAnnotate} />;
}
