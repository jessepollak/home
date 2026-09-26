import type { CSSProperties, PointerEvent } from "react";
import { useEffect, useRef } from "react";
import { pan, pinch, showFrameLabel, wheelCamera, type Camera, type Point, type Rect, type Size } from "./camera";
import { ChangeTag } from "./change-tag";
import { frameLabel, type Positioned, type Section } from "./layout";
import type { Metric } from "./use-frame-loading";
import { LiveFrame } from "./live-frame";
import styles from "./board.module.css";

export function DesktopCanvas({
  sections, positions, size, camera, transition, selected, interacting, spacePan, loaded, metrics,
  frameSource, activeFrame, onActiveFrameLoad, moveCamera, onSelect, onInteract, onExitInteract,
  onMark, onFinish, onCancel,
}: {
  sections: Section[];
  positions: Positioned[];
  size: Size;
  camera: Camera;
  transition: boolean;
  selected?: string;
  interacting?: string;
  spacePan: boolean;
  loaded: Set<string>;
  metrics: Metric[];
  frameSource: "story" | "blank";
  activeFrame: React.RefObject<HTMLIFrameElement | null>;
  onActiveFrameLoad: () => void;
  moveCamera: (updater: (old: Camera) => Camera) => void;
  onSelect: (position: Positioned) => void;
  onInteract: (position: Positioned) => void;
  onExitInteract: () => void;
  onMark: (id: string, patch: Partial<Metric>) => void;
  onFinish: (id: string, status: "rendered" | "errored") => void;
  onCancel: (id: string) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const gestureMoved = useRef(false);
  const lastGestureMoved = useRef(false);
  useEffect(() => {
    const canvas = element.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = canvas.getBoundingClientRect();
      const pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      moveCamera((old) => wheelCamera(old, event, pointer, canvas.clientHeight));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [moveCamera]);
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const panGesture = event.button === 1 || (event.button === 0 && spacePan);
    if (event.button !== 0 && !panGesture) return;
    if (pointers.current.size >= 2 ||
      (!panGesture && event.target instanceof HTMLElement && event.target.closest("button"))) return;
    if (interacting && !panGesture && event.pointerType !== "touch") onExitInteract();
    if (interacting && event.pointerType === "touch") return;
    if (event.button === 1) event.preventDefault();
    if (pointers.current.size === 0) {
      lastGestureMoved.current = false;
      gestureMoved.current = panGesture;
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
      if (other) moveCamera((old) => pinch(old, [previous, other], [point, other]));
      gestureMoved.current = true;
    } else {
      const dx = point.x - previous.x;
      const dy = point.y - previous.y;
      gestureMoved.current ||= Math.abs(dx) + Math.abs(dy) > 2;
      if (gestureMoved.current) moveCamera((old) => pan(old, { x: dx, y: dy }));
    }
  };
  const pointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(event.pointerId)) return;
    if (pointers.current.size === 0) {
      lastGestureMoved.current = gestureMoved.current;
      gestureMoved.current = false;
    }
  };
  const selectUnlessDragged = (position: Positioned) => {
    if (!lastGestureMoved.current) onSelect(position);
  };
  const screenStyle = (rect: Rect): CSSProperties => ({
    insetInlineStart: camera.x + rect.x * camera.zoom,
    top: camera.y + rect.y * camera.zoom,
    width: rect.width * camera.zoom,
  });
  return <div
    ref={element}
    className={`${styles.canvas} ${spacePan ? styles.panning : ""}`}
    dir="ltr"
    data-review-canvas=""
    onPointerDown={pointerDown}
    onPointerMove={pointerMove}
    onPointerUp={pointerEnd}
    onPointerCancel={pointerEnd}
    onMouseDown={(event) => { if (event.button === 1) event.preventDefault(); }}
    onAuxClick={(event) => { if (event.button === 1) event.preventDefault(); }}
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
        className={`${styles.desktopFrame} ${position.id === selected ? styles.selected : ""} ${
          position.id === interacting ? styles.interacting : ""}`}
        style={{ insetInlineStart: position.rect.x, top: position.rect.y,
          width: position.rect.width, height: position.rect.height }}
      >
        <LiveFrame
          position={position}
          metric={metrics.find((entry) => entry.id === position.id)}
          loaded={loaded.has(position.id)}
          active={interacting === position.id}
          frameSource={frameSource}
          frameRef={interacting === position.id ? activeFrame : undefined}
          onActiveLoad={onActiveFrameLoad}
          onMark={onMark}
          onFinish={onFinish}
          onCancel={onCancel}
          onSelect={() => selectUnlessDragged(position)}
          onFocusSelect={() => { if (pointers.current.size === 0) onSelect(position); }}
          onInteract={() => onInteract(position)}
        />
      </div>)}
    </div>
    <div className={styles.screenLabels}>
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
        <button title={position.frame.label} dir="auto" onClick={() => selectUnlessDragged(position)}>
          {frameLabel(position)}
        </button>
        {position.rect.width * camera.zoom >= 120 && <ChangeTag change={position.frame.change} />}
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
