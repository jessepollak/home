import { changeLabel, type ReviewBoard } from "./manifest";
import type { Positioned, Section } from "./layout";
import { storyCanvasUrl, storyManagerUrl } from "./url-state";
import styles from "./board.module.css";

export function Inspector({ board, section, position, onInteract, onFit, missing, canInteract }: {
  board: ReviewBoard;
  section?: Section;
  position?: Positioned;
  onInteract: () => void;
  onFit: () => void;
  missing: boolean;
  canInteract: boolean;
}) {
  return <aside className={styles.inspector} aria-label="Inspector">
    <div className={styles.panelHeading}><strong>Inspector</strong></div>
    {position ? <div className={styles.inspectorBody}>
      <h2>{section?.title}</h2>
      {section?.note && <p>{section.note}</p>}
      <div className={styles.inspectorDivider} />
      <h3>{position.before ? "Before · " : ""}{position.frame.label}</h3>
      <div className={styles.inspectorFacts}>
        <span className={position.frame.change === "unchanged" ? styles.muted : styles.accent}>
          {changeLabel(position.frame.change)}
        </span>
        <span>{position.rect.width} × {position.rect.height}</span>
      </div>
      {position.frame.note && <p>{position.frame.note}</p>}
      <span className={styles.fieldLabel}>Story ID</span>
      <code className={styles.storyId}>{position.story}</code>
      <button className={styles.primary} onClick={onInteract} disabled={missing || !canInteract}>Interact</button>
      <button onClick={onFit}>Fit frame</button>
      {!missing && <>
        <a href={storyManagerUrl(position.story)} target="_blank" rel="noreferrer">Open story ↗</a>
        <a href={storyCanvasUrl(position.story)} target="_blank" rel="noreferrer">Open canvas ↗</a>
      </>}
    </div> : <div className={styles.inspectorBody}>
      <p>{board.summary}</p>
      <h2>Shortcuts</h2>
      <p>+ / − Zoom · 0 Reset · 1 Fit board · 2 / F Fit frame</p>
      <p>Arrow keys Pan · Tab Browse frames · Enter Interact · Esc Return</p>
    </div>}
  </aside>;
}
