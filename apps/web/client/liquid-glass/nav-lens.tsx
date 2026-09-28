"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { shouldRefractNavRim, type EngineBrand } from "./lens-gate";
import { generateLensMaps } from "./lens-map";
import { createRecentCache } from "./recent-cache";
import { readNavLensEnvironment, type NavLensProps } from "./use-nav-lens";
import {
  navigationTabContentClassName,
  navigationTabIconClassName,
  navigationTabLabelClassName,
  navigationTabTone,
} from "@/components/primary-navigation-tab";
import styles from "./nav-lens.module.css";

type LensSize = { width: number; height: number; ratio: number };
type LensImages = { displacement: string; specular: string; scale: number; margin: number };
type LensFilter = LensImages & LensSize & { id: string };
type RimImages = { displacement: string; core: string; scale: number };
type RimFilter = RimImages & LensSize & { id: string };
type LensTrackProps = Pick<NavLensProps, "items" | "target"> & { className: string; tone: keyof typeof navigationTabTone };

const BEZEL = 10;
const THICKNESS = 10;
const NEUTRAL = "rgb(128 128 128)";
const SPECULAR_GAIN = 2.5;
const RIM_BEZEL = 28;
const RIM_THICKNESS = 12;
const RIM_FALLOFF = 1.6;
const RIM_SOFTEN = 0.5;
const RIM_FROST = 4;
const RIM_CORE_INSET = 19;
const RIM_CORE_FEATHER = 5;
const RELEASE_MS = 200;
const HOLD_MS = 600;
const SUPPRESS_MS = 400;
const LIFT_MS = 34;
const GLIDE_MS = 150;
const SLOP = 8;
const REACH = 24;
const LIFT_X = 1.25;
const LIFT_Y = 1.3;
const HOLE_PAD = 12;
const HOLE_MARGIN = 1.5;
const cache = createRecentCache<LensImages>(4);
const rimCache = createRecentCache<RimImages>(4);
const holeCache = createRecentCache<string>(8);

function sizeKey({ width, height, ratio }: LensSize) {
  return `${width}x${height}x${Math.round(ratio * 100)}`;
}

function buildImages(size: LensSize): LensImages | null {
  const { width, height, ratio } = size;
  const key = sizeKey(size);
  const cached = cache.get(key);
  if (cached) return cached;
  const maps = generateLensMaps({ width, height, radius: height / 2 }, { pixelRatio: ratio, bezel: BEZEL, thickness: THICKNESS });
  if (maps.width === 0 || maps.height === 0) return null;
  const margin = Math.ceil(maps.scale / 2) + 2 + Math.ceil(width * (LIFT_X - 1) / 2 + HOLE_MARGIN);
  const pad = Math.round(margin * ratio);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return null;
  canvas.width = maps.width + pad * 2;
  canvas.height = maps.height + pad * 2;
  context.fillStyle = NEUTRAL;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.putImageData(new ImageData(new Uint8ClampedArray(maps.displacement), maps.width, maps.height), pad, pad);
  const displacement = canvas.toDataURL("image/png");
  canvas.width = maps.width;
  canvas.height = maps.height;
  const highlight = new Uint8ClampedArray(maps.specular);
  for (let offset = 3; offset < highlight.length; offset += 4) highlight[offset] *= SPECULAR_GAIN;
  context.putImageData(new ImageData(highlight, maps.width, maps.height), 0, 0);
  const specular = canvas.toDataURL("image/png");
  return cache.set(key, { displacement, specular, scale: maps.scale, margin });
}

function buildRim(size: LensSize): RimImages | null {
  const { width, height, ratio } = size;
  const key = sizeKey(size);
  const cached = rimCache.get(key);
  if (cached) return cached;
  const maps = generateLensMaps({ width, height, radius: height / 2 }, { pixelRatio: ratio, bezel: RIM_BEZEL, thickness: RIM_THICKNESS, falloff: RIM_FALLOFF });
  if (maps.width === 0 || maps.height === 0) return null;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return null;
  canvas.width = maps.width;
  canvas.height = maps.height;
  context.putImageData(new ImageData(new Uint8ClampedArray(maps.displacement), maps.width, maps.height), 0, 0);
  const displacement = canvas.toDataURL("image/png");
  const inset = RIM_CORE_INSET * ratio;
  context.clearRect(0, 0, maps.width, maps.height);
  context.filter = `blur(${RIM_CORE_FEATHER * ratio}px)`;
  context.fillStyle = "#fff";
  context.beginPath();
  context.roundRect(inset, inset, maps.width - inset * 2, maps.height - inset * 2, Math.max(0, maps.height / 2 - inset));
  context.fill();
  const core = canvas.toDataURL("image/png");
  return rimCache.set(key, { displacement, core, scale: maps.scale });
}

function buildHole(size: LensSize, scaleX: number, scaleY: number, cut: boolean) {
  const key = `${sizeKey(size)}x${scaleX}x${scaleY}x${cut}`;
  const cached = holeCache.get(key);
  if (cached) return cached;
  const width = size.width * 3;
  const height = size.height + HOLE_PAD * 2;
  const holeWidth = size.width * scaleX + HOLE_MARGIN * 2;
  const holeHeight = Math.min(height, size.height * scaleY + HOLE_MARGIN * 2);
  const radius = holeHeight / 2;
  const left = (width - holeWidth) / 2;
  const top = (height - holeHeight) / 2;
  const n = (value: number) => Math.round(value * 100) / 100;
  const path = `${cut ? `M0 0H${width}V${height}H0Z ` : ""}M${n(left + radius)} ${n(top)}H${n(left + holeWidth - radius)}A${n(radius)} ${n(radius)} 0 0 1 ${n(left + holeWidth - radius)} ${n(top + holeHeight)}H${n(left + radius)}A${n(radius)} ${n(radius)} 0 0 1 ${n(left + radius)} ${n(top)}Z`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><path fill-rule="evenodd" d="${path}"/></svg>`;
  return holeCache.set(key, `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
}

function readRatio() {
  return Math.max(1, Math.min(2, window.devicePixelRatio || 1));
}

function LensTrack({ items, target, className, tone }: LensTrackProps) {
  const colors = navigationTabTone[tone];
  return (
    <span className={`${styles.track} ${className} grid grid-cols-2`} style={{ transform: `translateX(${target * -50}%)` }}>
      {items.map(({ id, label, Icon }) => (
        <span key={id} className={`${styles.tab} ${tone === "unselected" ? styles.unselected : ""} ${navigationTabContentClassName} px-2`}>
          <Icon className={`${styles.icon} ${navigationTabIconClassName} ${colors.icon}`} aria-hidden="true" />
          <span className={`${styles.label} ${navigationTabLabelClassName} ${colors.label}`}>{label}</span>
        </span>
      ))}
    </span>
  );
}

function readRimEnabled() {
  const brands = (navigator as Navigator & { userAgentData?: { brands?: readonly EngineBrand[] } }).userAgentData?.brands;
  return shouldRefractNavRim({ ...readNavLensEnvironment(), brands });
}

function useLensSize(element: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<LensSize | null>(null);
  useLayoutEffect(() => {
    const node = element.current;
    if (!node) return;
    let resolution: MediaQueryList | null = null;
    const measure = () => {
      const ratio = readRatio();
      const width = Math.round(node.offsetWidth);
      const height = Math.round(node.offsetHeight);
      setSize((current) => current && current.width === width && current.height === height && current.ratio === ratio
        ? current : { width, height, ratio });
    };
    const watchResolution = () => {
      resolution?.removeEventListener("change", onResolution);
      resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      resolution.addEventListener("change", onResolution);
    };
    const onResolution = () => { watchResolution(); measure(); };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    watchResolution();
    measure();
    return () => {
      observer.disconnect();
      resolution?.removeEventListener("change", onResolution);
    };
  }, [element]);
  return size;
}

export function NavLens({ items, target, reducedMotion, onReadyChange }: NavLensProps) {
  const windowRef = useRef<HTMLSpanElement>(null);
  const targetRef = useRef(target);
  const [override, setOverride] = useState<{ base: number | null; place: number } | null>(null);
  const floorRef = useRef<HTMLElement | null>(null);
  const baseId = `nav-lens-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [rimEnabled] = useState(readRimEnabled);
  useLayoutEffect(() => {
    floorRef.current = rimEnabled ? windowRef.current?.parentElement?.querySelector<HTMLElement>("[data-navigation-floor]") ?? null : null;
  }, [rimEnabled]);
  const size = useLensSize(windowRef);
  const floorSize = useLensSize(floorRef);
  const filter = useMemo<LensFilter | null>(() => {
    const images = size ? buildImages(size) : null;
    return size && images ? { ...images, ...size, id: `${baseId}-${sizeKey(size)}` } : null;
  }, [size, baseId]);
  const rim = useMemo<RimFilter | null>(() => {
    const images = floorSize ? buildRim(floorSize) : null;
    return floorSize && images ? { ...images, ...floorSize, id: `${baseId}-rim-${sizeKey(floorSize)}` } : null;
  }, [floorSize, baseId]);
  const masks = useMemo(() => size ? {
    "--lens-hole": buildHole(size, 1, 1, true),
    "--lens-hole-lifted": buildHole(size, LIFT_X, LIFT_Y, true),
    "--lens-clip": buildHole(size, 1, 1, false),
    "--lens-clip-lifted": buildHole(size, LIFT_X, LIFT_Y, false),
  } as CSSProperties : null, [size]);

  useLayoutEffect(() => {
    targetRef.current = target;
  }, [target]);

  useLayoutEffect(() => {
    const nav = windowRef.current?.parentElement;
    if (!nav || reducedMotion) return;
    let gesture: { id: number; x: number; y: number; index: number; dragged: boolean } | null = null;
    let narrow = 0;
    let hold = 0;
    let glide = 0;
    let settle = 0;
    let busyUntil = 0;
    let suppressUntil = 0;
    const tabs = () => Array.from(nav.querySelectorAll<HTMLButtonElement>(":scope > button"));
    const show = (index: number | null) => {
      clearTimeout(hold);
      clearTimeout(glide);
      if (index === null) setOverride(null);
      else setOverride({ base: null, place: getComputedStyle(nav).direction === "rtl" ? -index : index });
    };
    const tabAt = (x: number, y: number) => {
      const bounds = nav.getBoundingClientRect();
      if (y < bounds.top - REACH || y > bounds.bottom + REACH) return -1;
      return tabs().findIndex((tab) => {
        const rect = tab.getBoundingClientRect();
        return x >= rect.left && x < rect.right;
      });
    };
    const lower = () => {
      clearTimeout(narrow);
      nav.removeAttribute("data-lens-pressed");
      narrow = window.setTimeout(() => nav.removeAttribute("data-lens-wide"), RELEASE_MS);
    };
    const finish = () => {
      clearTimeout(settle);
      settle = window.setTimeout(() => {
        settle = 0;
        lower();
        setOverride((current) => current && { ...current, base: targetRef.current });
        hold = window.setTimeout(() => show(null), HOLD_MS);
      }, busyUntil - performance.now());
    };
    const press = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0 || !(event.target instanceof Element)) return;
      const tab = event.target.closest("button");
      if (!tab || tab.parentElement !== nav) return;
      const index = tabs().indexOf(tab);
      const lifted = nav.hasAttribute("data-lens-pressed");
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, index, dragged: false };
      clearTimeout(narrow);
      clearTimeout(settle);
      settle = 0;
      nav.setAttribute("data-lens-wide", "");
      nav.setAttribute("data-lens-pressed", "");
      busyUntil = performance.now() + (lifted ? 0 : LIFT_MS) + GLIDE_MS;
      if (lifted) show(index);
      else {
        clearTimeout(hold);
        glide = window.setTimeout(() => show(index), LIFT_MS);
      }
    };
    const reset = () => {
      gesture = null;
      clearTimeout(settle);
      settle = 0;
      lower();
      show(null);
    };
    const startPointer = (event: PointerEvent) => {
      suppressUntil = 0;
      if (gesture && event.pointerId !== gesture.id) reset();
    };
    const move = (event: PointerEvent) => {
      if (!gesture || event.pointerId !== gesture.id) return;
      if (!gesture.dragged) {
        if (Math.abs(event.clientX - gesture.x) <= SLOP && Math.abs(event.clientY - gesture.y) <= SLOP) return;
        gesture.dragged = true;
      }
      const index = tabAt(event.clientX, event.clientY);
      if (index < 0 || index === gesture.index) return;
      gesture.index = index;
      show(index);
    };
    const end = (event: PointerEvent) => {
      if (!gesture || event.pointerId !== gesture.id) return;
      const { dragged } = gesture;
      gesture = null;
      if (!dragged) return finish();
      suppressUntil = event.timeStamp + SUPPRESS_MS;
      const index = tabAt(event.clientX, event.clientY);
      if (index < 0) return reset();
      show(index);
      finish();
      tabs()[index]?.click();
    };
    const drop = (event: PointerEvent) => { if (gesture && event.pointerId === gesture.id) reset(); };
    const swallow = (event: MouseEvent) => {
      if (!event.isTrusted || event.detail === 0 || event.timeStamp > suppressUntil) return;
      suppressUntil = 0;
      event.preventDefault();
      event.stopPropagation();
    };
    const hide = () => { if (document.visibilityState === "hidden") reset(); };
    const confirmed = () => { if (!gesture && !settle) show(null); };
    const off = new AbortController();
    const signal = off.signal;
    const listen = { capture: true, passive: true, signal };
    nav.addEventListener("pointerdown", press, { passive: true, signal });
    nav.addEventListener("click", swallow, { capture: true, signal });
    nav.addEventListener("click", confirmed, { signal });
    document.addEventListener("pointerdown", startPointer, listen);
    document.addEventListener("pointermove", move, listen);
    document.addEventListener("pointerup", end, listen);
    document.addEventListener("pointercancel", drop, listen);
    document.addEventListener("lostpointercapture", drop, listen);
    window.addEventListener("blur", reset, { signal });
    document.addEventListener("visibilitychange", hide, { signal });
    return () => {
      off.abort();
      clearTimeout(narrow);
      clearTimeout(hold);
      clearTimeout(glide);
      clearTimeout(settle);
      nav.removeAttribute("data-lens-pressed");
      nav.removeAttribute("data-lens-wide");
      setOverride(null);
    };
  }, [reducedMotion]);

  useLayoutEffect(() => {
    const nav = windowRef.current?.parentElement;
    if (!nav || !rim) return;
    nav.style.setProperty("--glass-rim-lens", `url(#${rim.id})`);
    nav.setAttribute("data-glass-rim", "");
    return () => {
      nav.style.removeProperty("--glass-rim-lens");
      nav.removeAttribute("data-glass-rim");
    };
  }, [rim]);

  const ready = filter !== null && masks !== null;
  useLayoutEffect(() => {
    onReadyChange(ready);
  }, [ready, onReadyChange]);
  useLayoutEffect(() => () => onReadyChange(false), [onReadyChange]);

  const place = override && (override.base ?? target) === target ? override.place : target;
  const slide = { transform: `translateX(${place * 100}%)`, "--lens-lift-x": LIFT_X, "--lens-lift-y": LIFT_Y } as CSSProperties;
  const motion = reducedMotion ? styles.still : "";

  return (
    <>
      <span
        aria-hidden="true"
        inert
        data-navigation-lens-layer="unselected"
        className={`${styles.slide} ${motion} pointer-events-none absolute inset-y-1 start-1 z-20 select-none`}
        style={slide}
      >
        {ready ? (
          <span className={`${styles.cutout} ${styles.hole} absolute`} style={masks ?? undefined}>
            <LensTrack items={items} target={place} className={`${styles.cutoutTrack} absolute`} tone="unselected" />
          </span>
        ) : null}
      </span>
      <span
        ref={windowRef}
        aria-hidden="true"
        inert
        data-navigation-lens={ready ? "ready" : "pending"}
        className={`${styles.slide} ${styles.window} ${motion} pointer-events-none absolute inset-y-1 start-1 z-20 select-none`}
        style={slide}
      >
        {filter || rim ? (
          <svg className="absolute size-0 overflow-hidden" focusable="false">
            {filter ? (
              <filter
                id={filter.id}
                x={-filter.margin / filter.width}
                y={-filter.margin / filter.height}
                width={1 + filter.margin * 2 / filter.width}
                height={1 + filter.margin * 2 / filter.height}
                colorInterpolationFilters="sRGB"
              >
                <feImage
                  href={filter.displacement}
                  x={-filter.margin}
                  y={-filter.margin}
                  width={filter.width + filter.margin * 2}
                  height={filter.height + filter.margin * 2}
                  preserveAspectRatio="none"
                  result="map"
                />
                <feDisplacementMap in="SourceGraphic" in2="map" scale={filter.scale} xChannelSelector="R" yChannelSelector="G" />
              </filter>
            ) : null}
            {rim ? (
              <filter
                id={rim.id}
                filterUnits="userSpaceOnUse"
                primitiveUnits="userSpaceOnUse"
                x={0}
                y={0}
                width={rim.width}
                height={rim.height}
                colorInterpolationFilters="sRGB"
              >
                <feImage href={rim.displacement} x={0} y={0} width={rim.width} height={rim.height} preserveAspectRatio="none" result="map" />
                <feGaussianBlur in="SourceGraphic" stdDeviation={RIM_SOFTEN} result="softEdge" />
                <feComponentTransfer in="softEdge" result="soft">
                  <feFuncA type="linear" slope={0} intercept={1} />
                </feComponentTransfer>
                <feDisplacementMap in="soft" in2="map" scale={-rim.scale} xChannelSelector="R" yChannelSelector="G" result="bent" />
                <feGaussianBlur in="SourceGraphic" stdDeviation={RIM_FROST} result="frostEdge" />
                <feComponentTransfer in="frostEdge" result="frost">
                  <feFuncA type="linear" slope={0} intercept={1} />
                </feComponentTransfer>
                <feImage href={rim.core} x={0} y={0} width={rim.width} height={rim.height} preserveAspectRatio="none" result="core" />
                <feComposite in="frost" in2="core" operator="in" result="center" />
                <feMerge>
                  <feMergeNode in="bent" />
                  <feMergeNode in="center" />
                </feMerge>
              </filter>
            ) : null}
          </svg>
        ) : null}
        <span data-navigation-lens-body="" className={`${styles.body} absolute inset-0`}>
          <span className={`${styles.tint} absolute inset-0`} />
        </span>
        <span className={`${styles.cutout} ${styles.clip} absolute`} style={masks ?? undefined}>
          <span className={`${styles.magnifier} absolute`}>
            <span className={`${styles.refraction} absolute inset-0`} style={filter ? { filter: `url(#${filter.id})` } : undefined}>
              <LensTrack items={items} target={place} className="absolute inset-y-0 start-0 w-[200%]" tone="selected" />
            </span>
          </span>
        </span>
        <span className={`${styles.body} absolute inset-0`}>
          {filter ? (
            <span
              className={`${styles.specular} absolute inset-0`}
              style={{ maskImage: `url(${filter.specular})`, WebkitMaskImage: `url(${filter.specular})` }}
            />
          ) : null}
          <span className={`${styles.shine} absolute inset-0`} />
        </span>
      </span>
    </>
  );
}
