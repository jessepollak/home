import { Button, buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ChangeTag, FrameSize } from "./change-tag";
import { frameLabel, type Positioned, type Section } from "./layout";
import { storyCanvasUrl, storyManagerUrl } from "./url-state";
import type { BoardCommand } from "./commands";
import { ShortcutList } from "./shortcuts-help";
import styles from "./board.module.css";

const keyShortcuts = ["fit-board", "fit-selection", "interact", "command-palette"];

export function Inspector({ section, position, onInteract, onFit, canInteract, shortcuts, onShowShortcuts }: {
  section?: Section;
  position: Positioned;
  onInteract: () => void;
  onFit: () => void;
  canInteract: boolean;
  shortcuts: BoardCommand[];
  onShowShortcuts: () => void;
}) {
  const link = (href: string, label: string) => <a data-slot="button" href={href} target="_blank" rel="noreferrer"
    className={buttonVariants({ variant: "link", size: "inline", className: "self-start" })}>{label} ↗</a>;
  return <aside className={styles.inspector} aria-label="Inspector">
    <div className={styles.panelHeading}><strong>Inspector</strong></div>
    <div className={styles.inspectorBody}>
      <h2>{section?.title}</h2>
      {section?.note && <p>{section.note}</p>}
      <Separator className="my-2" />
      <h3>{frameLabel(position)}</h3>
      <div className={styles.inspectorFacts}>
        <ChangeTag change={position.frame.change} />
        <FrameSize width={position.rect.width} height={position.rect.height} />
      </div>
      {position.frame.note && <p>{position.frame.note}</p>}
      <span className={styles.fieldLabel}>Story ID</span>
      <code className={styles.storyId}>{position.story}</code>
      <div className={styles.inspectorActions}>
        <Button onClick={onInteract} disabled={!canInteract}>Interact</Button>
        <Button variant="outline" onClick={onFit}>Fit frame</Button>
      </div>
      {link(storyManagerUrl(position.story), "Open story")}
      {link(storyCanvasUrl(position.story), "Open canvas")}
      <Separator className="my-2" />
      <ShortcutList label="Shortcuts" commands={shortcuts.filter((command) => keyShortcuts.includes(command.id))} />
      <Button variant="ghost" size="sm" className="self-start" onClick={onShowShortcuts}>All shortcuts</Button>
    </div>
  </aside>;
}
