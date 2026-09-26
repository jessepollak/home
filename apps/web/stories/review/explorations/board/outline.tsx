import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ChangeTag, FrameSize } from "./change-tag";
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
  const outlineBody = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = selectedRow.current;
    const body = outlineBody.current;
    if (!row || !body) return;
    const top = row.getBoundingClientRect().top - body.getBoundingClientRect().top;
    if (top < 0) body.scrollTop += top;
    else if (top + row.offsetHeight > body.clientHeight)
      body.scrollTop += top + row.offsetHeight - body.clientHeight;
  }, [selected]);
  const changed = sections.flatMap((section) => section.frames).filter((position) => position.frame.change !== "unchanged");
  const pinned = changed.some((position) => position.id === selected);
  const row = (position: Positioned, track: boolean) => <Button
    key={position.id}
    ref={track && position.id === selected ? selectedRow : undefined}
    variant={position.id === selected ? "secondary" : "ghost"}
    size="sm"
    press="none"
    className="w-full justify-start"
    aria-current={position.id === selected ? "true" : undefined}
    onClick={() => onSelect(position.id)}
    title={frameLabel(position)}
  >
    <span className={styles.rowLabel}>{frameLabel(position)}</span>
    <ChangeTag change={position.frame.change} />
    <FrameSize width={position.rect.width} height={position.rect.height} compact />
  </Button>;
  const changedTitle = inPr ? "Changed in this PR" : "Changed";
  return <aside className={styles.outline} aria-label="Outline">
    <div className={styles.panelHeading}><strong>Outline</strong></div>
    <div ref={outlineBody} className={styles.outlineBody}>
      <p className={styles.summary}>{board.summary}</p>
      {changed.length > 0 && <>
        <div className={styles.outlineGroup} role="group" aria-label={changedTitle}>
          <div className={styles.outlineHeading}>{changedTitle}</div>
          {changed.map((position) => row(position, true))}
        </div>
        <Separator />
      </>}
      {sections.map((section) => <div className={styles.outlineGroup} key={section.id} role="group" aria-label={section.title}>
        <Button variant="ghost" size="sm" press="none" className="w-full justify-start"
          onClick={() => onFitSection(section)}>
          {section.title}
        </Button>
        {section.frames.map((position) => row(position, !pinned))}
      </div>)}
    </div>
  </aside>;
}
