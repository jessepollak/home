import { useLayoutEffect, useRef, useState, type Ref } from "react";
import type { BoardFrame, BoardSection, ReviewBoard } from "./manifest";
import { ChangeTag } from "./change-tag";
import type { Positioned, Side } from "./layout";
import type { Metric } from "./use-frame-loading";
import { LiveFrame } from "./live-frame";
import styles from "./board.module.css";

export function MobileReview({
  board, current, position, index, metric, loaded, frameSource, fullButton,
  onSelect, onSide, onOpen, onMark, onFinish, onCancel,
}: {
  board: ReviewBoard;
  current: { section: BoardSection; frame: BoardFrame };
  position?: Positioned;
  index: number;
  metric?: Metric;
  loaded: boolean;
  frameSource: "story" | "blank";
  fullButton: Ref<HTMLButtonElement>;
  onSelect: (id: string) => void;
  onSide: (side: Side) => void;
  onOpen: () => void;
  onMark: (id: string, patch: Partial<Metric>) => void;
  onFinish: (id: string, status: "rendered" | "errored") => void;
  onCancel: (id: string) => void;
}) {
  const frames = board.sections.flatMap((section) => section.frames);
  const frameSpace = useRef<HTMLDivElement>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  useLayoutEffect(() => {
    const element = frameSpace.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setFrameWidth(entry.contentRect.width));
    setFrameWidth(element.clientWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [position?.id]);
  const scale = position ? Math.min(1, frameWidth / position.rect.width) : 1;
  return <div className={styles.mobile}>
    <div className={styles.mobileScroll}>
      <select aria-label="Select frame" value={current.frame.id}
        onChange={(event) => onSelect(event.target.value)}>
        {board.sections.map((section) => <optgroup key={section.id} label={section.title}>
          {section.frames.map((frame) => <option key={frame.id} value={frame.id}>
            {section.title} · {frame.label}
          </option>)}
        </optgroup>)}
      </select>
      <h2>{current.section.title}</h2>
      {current.section.note && <p className={styles.muted}>{current.section.note}</p>}
      {position && <div className={styles.mobileCard}>
        <div className={styles.mobileFrameHeading}>
          <strong>{position.frame.label}</strong>
          <ChangeTag change={position.frame.change} />
        </div>
        <span className={styles.muted}>{position.rect.width} × {position.rect.height}</span>
        {position.frame.before && <div className={styles.segment} aria-label="Before and after">
          <button aria-pressed={!position.before} onClick={() => onSide("after")}>Proposed</button>
          <button aria-pressed={position.before} onClick={() => onSide("before")}>Before</button>
        </div>}
        <div ref={frameSpace} className={styles.mobileFrameSpace}>
          <LiveFrame
            position={position}
            metric={metric}
            loaded={loaded}
            active={false}
            frameSource={frameSource}
            scale={scale}
            onMark={onMark}
            onFinish={onFinish}
            onCancel={onCancel}
            onSelect={() => onSelect(position.frame.id)}
            onInteract={onOpen}
          />
        </div>
        {position.frame.note && <p>{position.frame.note}</p>}
      </div>}
    </div>
    <nav className={styles.mobileActions} aria-label="Frame navigation">
      <button disabled={index === 0} onClick={() => onSelect(frames[index - 1].id)}>Previous</button>
      <button ref={fullButton} className={styles.primary} onClick={onOpen}>Open full width</button>
      <button disabled={index === frames.length - 1}
        onClick={() => onSelect(frames[index + 1].id)}>Next</button>
    </nav>
  </div>;
}
