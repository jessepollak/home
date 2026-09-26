import { ChangeTag } from "./change-tag";
import { frameLabel, type Positioned, type Section } from "./layout";
import { storyCanvasUrl, storyManagerUrl } from "./url-state";
import styles from "./board.module.css";

const shortcuts: Array<[string, string]> = [
  ["Scroll", "Pan"],
  ["⌘ Scroll / Pinch", "Zoom"],
  ["Space + Drag", "Pan"],
  ["⇧1 / ⇧2", "Fit board / selection"],
  ["⌘0", "Zoom to 100%"],
  ["Enter / Double-click", "Interact"],
  ["⌘\\", "Hide panels"],
];

export function Inspector({ section, position, onInteract, onFit, canInteract }: {
  section?: Section;
  position: Positioned;
  onInteract: () => void;
  onFit: () => void;
  canInteract: boolean;
}) {
  return <aside className={styles.inspector} aria-label="Inspector">
    <div className={styles.panelHeading}><strong>Inspector</strong></div>
    <div className={styles.inspectorBody}>
      <h2>{section?.title}</h2>
      {section?.note && <p>{section.note}</p>}
      <div className={styles.inspectorDivider} />
      <h3>{frameLabel(position)}</h3>
      <div className={styles.inspectorFacts}>
        <ChangeTag change={position.frame.change} />
        <span>{position.rect.width} × {position.rect.height}</span>
      </div>
      {position.frame.note && <p>{position.frame.note}</p>}
      <span className={styles.fieldLabel}>Story ID</span>
      <code className={styles.storyId}>{position.story}</code>
      <button className={styles.primary} onClick={onInteract} disabled={!canInteract}>Interact</button>
      <button onClick={onFit}>Fit frame</button>
      <a href={storyManagerUrl(position.story)} target="_blank" rel="noreferrer">Open story ↗</a>
      <a href={storyCanvasUrl(position.story)} target="_blank" rel="noreferrer">Open canvas ↗</a>
      <div className={styles.inspectorDivider} />
      <dl className={styles.shortcuts} aria-label="Shortcuts">
        {shortcuts.map(([keys, action]) => <div key={keys}><dt>{keys}</dt><dd>{action}</dd></div>)}
      </dl>
    </div>
  </aside>;
}
