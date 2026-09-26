import { useEffect, useRef } from "react";
import { ChangeTag } from "./change-tag";
import { frameLabel, type Section } from "./layout";
import type { ReviewBoard } from "./manifest";
import styles from "./board.module.css";

export function Outline({ board, sections, selected, onSelect, onFitSection }: {
  board: ReviewBoard;
  sections: Section[];
  selected?: string;
  onSelect: (id: string) => void;
  onFitSection: (section: Section) => void;
}) {
  const selectedRow = useRef<HTMLButtonElement>(null);
  useEffect(() => { selectedRow.current?.scrollIntoView({ block: "nearest" }); }, [selected]);
  return <aside className={styles.outline} aria-label="Outline">
    <div className={styles.panelHeading}><strong>Outline</strong></div>
    <div className={styles.outlineBody}>
      <p className={styles.summary}>{board.summary}</p>
      {sections.map((section) => <div className={styles.outlineSection} key={section.id}>
        <button className={styles.outlineSectionButton} onClick={() => onFitSection(section)}>
          {section.title}
        </button>
        {section.frames.map((position) => <button
          key={position.id}
          ref={position.id === selected ? selectedRow : undefined}
          className={styles.outlineRow}
          aria-current={position.id === selected ? "true" : undefined}
          onClick={() => onSelect(position.id)}
          title={frameLabel(position)}
        >
          <span className={styles.rowLabel}>{frameLabel(position)}</span>
          <ChangeTag change={position.frame.change} />
          <span className={styles.muted}>{position.rect.width}</span>
        </button>)}
      </div>)}
    </div>
  </aside>;
}
