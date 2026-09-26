import { useEffect, useRef } from "react";
import { changeLabel, type ReviewBoard } from "./manifest";
import type { Section } from "./layout";
import styles from "./board.module.css";

export function Outline({ board, sections, selected, collapsed, onToggle, onSelect, onFitSection }: {
  board: ReviewBoard;
  sections: Section[];
  selected?: string;
  collapsed: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
  onFitSection: (section: Section) => void;
}) {
  const selectedRow = useRef<HTMLButtonElement>(null);
  useEffect(() => { selectedRow.current?.scrollIntoView({ block: "nearest" }); }, [selected, collapsed]);
  return <aside className={`${styles.outline} ${collapsed ? styles.collapsed : ""}`} aria-label="Outline">
    <div className={styles.panelHeading}>
      {!collapsed && <strong>Outline</strong>}
      <button aria-label={collapsed ? "Expand outline" : "Collapse outline"} onClick={onToggle}>
        {collapsed ? "›" : "‹"}
      </button>
    </div>
    {!collapsed && <div className={styles.outlineBody}>
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
          title={`${position.before ? "Before · " : ""}${position.frame.label}`}
        >
          <span className={styles.rowLabel}>{position.before ? "Before · " : ""}{position.frame.label}</span>
          <span className={position.frame.change === "unchanged" ? styles.muted : styles.accent}>
            {changeLabel(position.frame.change)}
          </span>
          <span className={styles.muted}>{position.rect.width}</span>
        </button>)}
      </div>)}
    </div>}
  </aside>;
}
