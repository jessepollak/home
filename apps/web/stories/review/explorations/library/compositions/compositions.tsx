import { useCallback } from "react";
import type { StoryIndexEntry } from "../../board/review-build";
import { useDeadlineResource } from "../use-deadline-resource";
import { SectionMessage } from "../section-message";
import { VariantSheet } from "../sheet";
import { loadCompositionStories } from "../stories";

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
  const load = useCallback(() => loadCompositionStories(entries), [entries]);
  const { value: stories, failed } = useDeadlineResource(entries.length ? key : undefined, load);
  if (!entries.length) return <SectionMessage>No compositions are in this build.</SectionMessage>;
  if (!stories) {
    return <SectionMessage failed={failed}>
      {failed ? "Couldn't load the compositions. Reload to try again." : "Loading compositions…"}
    </SectionMessage>;
  }
  return <VariantSheet root={root} component="Compositions" changed={false} stories={stories} theme={theme}
    focused={focused} focusedArgs={null} annotating={annotating} frameSource={frameSource} showReasons={false}
    onToggle={onToggle} onEscape={onEscape} onExitAnnotate={onExitAnnotate} />;
}
