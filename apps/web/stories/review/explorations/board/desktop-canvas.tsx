import type { CSSProperties, PointerEvent, WheelEvent } from "react";
import { useRef } from "react";
import { pan, pinch, showFrameLabel, zoomAt, type Camera, type Point, type Rect, type Size } from "./camera";
import type { Positioned, Section } from "./layout";
import type { Metric } from "./use-frame-loading";
import { changeLabel } from "./manifest";
import { LiveFrame } from "./live-frame";
import styles from "./board.module.css";

export function DesktopCanvas({
  sections, positions, size, camera, transition, selected, interacting, loaded, metrics,
  available, frameSource, activeFrame, onActiveFrameLoad, setCamera, onSelect, onInteract, onMark, onFinish, onCancel,
}: {
  sections: Section[];
  positions: Positioned[];
  size: Size;
  camera: Camera;
  transition: boolean;
  selected?: string;
  interacting?: string;
  loaded: Set<string>;
  metrics: Metric[];
  available: Set<string> | null;
  frameSource: "story" | "blank";
  activeFrame: React.RefObject<HTMLIFrameElement | null>;
  onActiveFrameLoad: () => void;
  setCamera: (updater: (old: Camera) => Camera) => void;
  onSelect: (position: Positioned) => void;
  onInteract: (position: Positioned) => void;
  onMark: (id: string, patch: Partial<Metric>) => void;
  onFinish: (id: string, status: "rendered" | "errored") => void;
  onCancel: (id: string) => void;
}) {
  const pointers = useRef(new Map<number, Point>());
  const gestureMoved = useRef(false);
  const lastGestureMoved = useRef(false);
  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const rect = event.currentTarget.getBoundingClientRect();
      setCamera((old) => zoomAt(old, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      }, Math.exp(-event.deltaY / 400)));
    } else {
      setCamera((old) => pan(old, { x: -event.deltaX, y: -event.deltaY }));
    }
  };
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || interacting || pointers.current.size >= 2 ||
      (event.target instanceof HTMLElement && event.target.closest("button"))) return;
    if (pointers.current.size === 0) {
      lastGestureMoved.current = false;
      gestureMoved.current = false;
    } else {
      gestureMoved.current = true;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    pointers.current.set(event.pointerId, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size === 2) {
      const other = [...pointers.current].find(([id]) => id !== event.pointerId)?.[1];
      if (other) setCamera((old) => pinch(old, [previous, other], [point, other]));
      gestureMoved.current = true;
    } else {
      const dx = point.x - previous.x;
      const dy = point.y - previous.y;
      gestureMoved.current ||= Math.abs(dx) + Math.abs(dy) > 2;
      if (gestureMoved.current) setCamera((old) => pan(old, { x: dx, y: dy }));
    }
  };
  const pointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(event.pointerId)) return;
    if (pointers.current.size === 0) {
      lastGestureMoved.current = gestureMoved.current;
      gestureMoved.current = false;
    }
  };
  const screenStyle = (rect: Rect): CSSProperties => ({
    insetInlineStart: camera.x + rect.x * camera.zoom,
    top: camera.y + rect.y * camera.zoom,
    width: rect.width * camera.zoom,
  });
  return <div
    className={styles.canvas}
    dir="ltr"
    onWheel={onWheel}
    onPointerDown={pointerDown}
    onPointerMove={pointerMove}
    onPointerUp={pointerEnd}
    onPointerCancel={pointerEnd}
  >
    <div className={`${styles.layer} ${transition ? styles.fitTransition : ""}`}
      style={{ width: size.width, height: size.height,
        transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
        "--zoom": camera.zoom } as CSSProperties}>
      {sections.map((section) => <div key={section.id} className={styles.section} style={{
        insetInlineStart: section.rect.x, top: section.rect.y,
        width: section.rect.width, height: section.rect.height,
      }} />)}
      {positions.map((position) => <div
        key={position.id}
        className={`${styles.desktopFrame} ${position.frame.change !== "unchanged" ? styles.emphasis : ""}
          ${position.id === selected ? styles.selected : ""}
          ${position.id === interacting ? styles.interacting : ""}`}
        style={{ insetInlineStart: position.rect.x, top: position.rect.y,
          width: position.rect.width, height: position.rect.height }}
      >
        <LiveFrame
          position={position}
          metric={metrics.find((entry) => entry.id === position.id)}
          loaded={loaded.has(position.id)}
          missing={available !== null && !available.has(position.story)}
          active={interacting === position.id}
          frameSource={frameSource}
          frameRef={interacting === position.id ? activeFrame : undefined}
          onActiveLoad={onActiveFrameLoad}
          onMark={onMark}
          onFinish={onFinish}
          onCancel={onCancel}
          onSelect={() => { if (!lastGestureMoved.current) onSelect(position); }}
          onFocusSelect={() => { if (pointers.current.size === 0) onSelect(position); }}
          onInteract={() => onInteract(position)}
        />
      </div>)}
    </div>
    <div className={styles.screenLabels} aria-hidden="false">
      {sections.map((section) => <div key={section.id} className={styles.sectionLabel}
        style={{ ...screenStyle(section.rect),
          top: camera.y + section.rect.y * camera.zoom - (camera.zoom < 0.2 ? 20 : 36) }}>
        <strong title={section.title}>{section.title}</strong>
        {camera.zoom >= 0.35 && section.note && <span title={section.note}>{section.note}</span>}
      </div>)}
      {positions.filter((position) => showFrameLabel(position.rect.width, camera.zoom))
        .map((position) => <div key={position.id}
        className={styles.screenFrameLabel}
        style={{ ...screenStyle(position.rect), top: camera.y + position.rect.y * camera.zoom - 20 }}>
        <button title={position.frame.label} dir="auto" onClick={() => onSelect(position)}>
          {position.before ? "Before · " : ""}{position.frame.label}
        </button>
        {position.rect.width * camera.zoom >= 120 &&
          <span className={position.frame.change === "unchanged" ? styles.muted : styles.accent}>
            {changeLabel(position.frame.change)}
          </span>}
      </div>)}
      {positions.filter((position) => position.frame.note && position.rect.width * camera.zoom >= 240)
        .map((position) => <p key={position.id} className={styles.screenFrameNote}
          style={{ ...screenStyle(position.rect), top: camera.y +
            (position.rect.y + position.rect.height) * camera.zoom + 6 }}>
          {position.frame.note}
        </p>)}
    </div>
  </div>;
}
