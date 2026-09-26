import { useEffect, useRef } from "react";
import { ChangeTag } from "./change-tag";
import { frameLabel, type Positioned, type Section } from "./layout";
import type { ReviewBoard } from "./manifest";
import styles from "./board.module.css";

export function Outline({ board, sections, selected, inPr, onSelect, onFitSection }: {
  board: ReviewBoard;
  sections: Section[];
  selected?: string;
  inPr: boolean;
  onSelect: (id: string) => void;
  onFitSection: (section: Section) => void;
}) {
  const selectedRow = useRef<HTMLButtonElement>(null);
  useEffect(() => { selectedRow.current?.scrollIntoView({ block: "nearest" }); }, [selected]);
  const changed = sections.flatMap((section) => section.frames).filter((position) => position.frame.change !== "unchanged");
  const pinned = changed.some((position) => position.id === selected);
  const row = (position: Positioned, track: boolean) => <button
    key={position.id}
    ref={track && position.id === selected ? selectedRow : undefined}
    className={styles.outlineRow}
    aria-current={position.id === selected ? "true" : undefined}
    onClick={() => onSelect(position.id)}
    title={frameLabel(position)}
  >
    <span className={styles.rowLabel}>{frameLabel(position)}</span>
    <ChangeTag change={position.frame.change} />
    <span className={styles.muted}>{position.rect.width}</span>
  </button>;
  const changedTitle = inPr ? "Changed in this PR" : "Changed";
  return <aside className={styles.outline} aria-label="Outline">
    <div className={styles.panelHeading}><strong>Outline</strong></div>
    <div className={styles.outlineBody}>
      <p className={styles.summary}>{board.summary}</p>
      {changed.length > 0 && <div className={styles.outlineChanged} role="group" aria-label={changedTitle}>
        <div className={styles.outlineGroupTitle}>{changedTitle}</div>
        {changed.map((position) => row(position, true))}
      </div>}
      {sections.map((section) => <div className={styles.outlineSection} key={section.id} role="group" aria-label={section.title}>
        <button className={styles.outlineSectionButton} onClick={() => onFitSection(section)}>
          {section.title}
        </button>
        {section.frames.map((position) => row(position, !pinned))}
      </div>)}
    </div>
  </aside>;
}
