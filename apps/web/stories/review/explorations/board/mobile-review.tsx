import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type Ref } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { BoardFrame, BoardSection, ReviewBoard } from "./manifest";
import { ChangeTag } from "./change-tag";
import type { Positioned, Side } from "./layout";
import type { Metric } from "./use-frame-loading";
import { LiveFrame } from "./live-frame";
import styles from "./board.module.css";

const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 24;
const HINT_MS = 1600;

export function MobileReview({
  board, current, position, index, metric, loaded, interacting, frameSource, actionButton, activeFrame,
  onSelect, onSide, onInteract, onLeave, onActiveLoad, onMark, onFinish, onCancel,
}: {
  board: ReviewBoard;
  current: { section: BoardSection; frame: BoardFrame };
  position?: Positioned;
  index: number;
  metric?: Metric;
  loaded: boolean;
  interacting: boolean;
  frameSource: "story" | "blank";
  actionButton: Ref<HTMLButtonElement>;
  activeFrame: Ref<HTMLIFrameElement>;
  onSelect: (id: string) => void;
  onSide: (side: Side) => void;
  onInteract: () => void;
  onLeave: () => void;
  onActiveLoad: () => void;
  onMark: (id: string, patch: Partial<Metric>) => void;
  onFinish: (id: string, status: "rendered" | "errored") => void;
  onCancel: (id: string) => void;
}) {
  const frames = board.sections.flatMap((section) => section.frames);
  const frameSpace = useRef<HTMLDivElement>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  const [hint, setHint] = useState(false);
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLayoutEffect(() => {
    const element = frameSpace.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setFrameWidth(entry.contentRect.width));
    setFrameWidth(element.clientWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [position?.id]);
  useEffect(() => () => {
    if (hintTimer.current !== null) clearTimeout(hintTimer.current);
  }, []);
  const hideHint = () => {
    if (hintTimer.current !== null) clearTimeout(hintTimer.current);
    hintTimer.current = null;
    setHint(false);
  };
  const tap = (event: PointerEvent<HTMLDivElement>) => {
    if (interacting || event.button !== 0) return;
    const previous = lastTap.current;
    if (previous && event.timeStamp - previous.time <= DOUBLE_TAP_MS &&
      Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= DOUBLE_TAP_SLOP) {
      lastTap.current = null;
      hideHint();
      onInteract();
      return;
    }
    lastTap.current = { time: event.timeStamp, x: event.clientX, y: event.clientY };
    if (hintTimer.current !== null) clearTimeout(hintTimer.current);
    setHint(true);
    hintTimer.current = setTimeout(() => { hintTimer.current = null; setHint(false); }, HINT_MS);
  };
  const scale = position ? Math.min(1, frameWidth / position.rect.width) : 1;
  return <div className={styles.mobile}>
    <div className={styles.mobileScroll}>
      {position && <div className={styles.mobileCard}>
        <div className={styles.mobileFrameHeading}>
          <div className={styles.mobileFrameTitle}>
            <strong>{position.frame.label}</strong>
            <span className={styles.muted}>
              {current.section.title} · {position.rect.width}×{position.rect.height}
            </span>
          </div>
          <ChangeTag change={position.frame.change} />
        </div>
        {position.frame.before && <ToggleGroup variant="outline" spacing={0}
          aria-label="Before and after" value={[position.before ? "before" : "after"]}
          onValueChange={(value) => { if (value[0]) onSide(value[0] as Side); }}>
          <ToggleGroupItem value="after" className={styles.segmentItem}>Proposed</ToggleGroupItem>
          <ToggleGroupItem value="before" className={styles.segmentItem}>Before</ToggleGroupItem>
        </ToggleGroup>}
        <div ref={frameSpace} className={styles.mobileFrameSpace} onPointerUp={tap}>
          <LiveFrame
            position={position}
            metric={metric}
            loaded={loaded}
            active={interacting}
            frameSource={frameSource}
            scale={scale}
            frameRef={interacting ? activeFrame : undefined}
            onActiveLoad={onActiveLoad}
            onMark={onMark}
            onFinish={onFinish}
            onCancel={onCancel}
            onSelect={() => undefined}
            onFocusSelect={() => onSelect(position.frame.id)}
            onFit={onInteract}
            onInteract={onInteract}
          />
          {hint && !interacting && <Badge className={styles.mobileHint} role="status">
            Double-tap to interact
          </Badge>}
        </div>
        {position.frame.note && <p>{position.frame.note}</p>}
      </div>}
    </div>
    <nav className={styles.mobileActions} aria-label="Frame navigation">
      <ButtonGroup className={styles.mobileStepper} aria-label="Frames">
        <Button variant="outline" size="touch" className={styles.mobileStep} aria-label="Previous"
          disabled={index === 0} onClick={() => onSelect(frames[index - 1].id)}><ChevronLeftIcon /></Button>
        <select className={buttonVariants({ variant: "outline", size: "touch", press: "none",
          className: styles.mobilePicker })} aria-label="Select frame" value={current.frame.id}
          onChange={(event) => onSelect(event.target.value)}>
          {board.sections.map((section) => <optgroup key={section.id} label={section.title}>
            {section.frames.map((frame) => <option key={frame.id} value={frame.id}>
              {section.title} · {frame.label}
            </option>)}
          </optgroup>)}
        </select>
        <Button variant="outline" size="touch" className={styles.mobileStep} aria-label="Next"
          disabled={index === frames.length - 1} onClick={() => onSelect(frames[index + 1].id)}>
          <ChevronRightIcon />
        </Button>
      </ButtonGroup>
      <Button ref={actionButton} size="touch" className={styles.mobileAction}
        variant={interacting ? "outline" : "default"} disabled={!loaded}
        onClick={interacting ? onLeave : onInteract}>{interacting ? "Close" : "Interact"}</Button>
    </nav>
  </div>;
}
