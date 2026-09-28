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
} from "@/components/primary-navigation-tab";
import styles from "./nav-lens.module.css";

type LensSize = { width: number; height: number; ratio: number };
type LensImages = { displacement: string; specular: string; scale: number; margin: number };
type LensFilter = LensImages & LensSize & { id: string };
type RimImages = { displacement: string; core: string; scale: number };
type RimFilter = RimImages & LensSize & { id: string };
type LensTrackProps = Pick<NavLensProps, "items" | "target"> & { className: string; tone: string };

const BEZEL = 10;
const THICKNESS = 10;
const NEUTRAL = "rgb(128 128 128)";
const SPECULAR_GAIN = 2.5;
const RIM_BEZEL = 28;
const RIM_THICKNESS = 12;
const RIM_FALLOFF = 1.6;
const RIM_SOFTEN = 0.5;
const RIM_FROST = 24;
const RIM_CORE_INSET = 19;
const RIM_CORE_FEATHER = 5;
const MIN_PRESS_MS = 120;
const TRAVEL_MS = 400;
const STRETCH_X = 1.08;
const STRETCH_Y = .97;
const HOLE_PAD = 8;
const HOLE_MARGIN = 1.5;
const cache = createRecentCache<LensImages>(4);
const rimCache = createRecentCache<RimImages>(4);
const holeCache = createRecentCache<string>(4);

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
  const margin = Math.ceil(maps.scale / 2) + 2;
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

function buildHole(size: LensSize) {
  const key = sizeKey(size);
  const cached = holeCache.get(key);
  if (cached) return cached;
  const width = size.width * 3;
  const height = size.height + HOLE_PAD * 2;
  const holeWidth = size.width + HOLE_MARGIN * 2;
  const holeHeight = size.height + HOLE_MARGIN * 2;
  const radius = holeHeight / 2;
  const left = (width - holeWidth) / 2;
  const top = (height - holeHeight) / 2;
  const n = (value: number) => Math.round(value * 100) / 100;
  const path = `M0 0H${width}V${height}H0Z M${n(left + radius)} ${n(top)}H${n(left + holeWidth - radius)}A${n(radius)} ${n(radius)} 0 0 1 ${n(left + holeWidth - radius)} ${n(top + holeHeight)}H${n(left + radius)}A${n(radius)} ${n(radius)} 0 0 1 ${n(left + radius)} ${n(top)}Z`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><path fill-rule="evenodd" d="${path}"/></svg>`;
  return holeCache.set(key, `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
}

function readRatio() {
  return Math.max(1, Math.min(2, window.devicePixelRatio || 1));
}

function LensTrack({ items, target, className, tone }: LensTrackProps) {
  return (
    <span className={`${styles.track} ${className} grid grid-cols-2`} style={{ transform: `translateX(${target * -50}%)` }}>
      {items.map(({ id, label, Icon }) => (
        <span key={id} className={`${styles.tab} ${tone} flex min-w-0 items-center justify-center px-2`}>
          <span className={navigationTabContentClassName}>
            <Icon className={`${styles.icon} ${navigationTabIconClassName}`} aria-hidden="true" />
            <span className={`${styles.label} ${navigationTabLabelClassName}`}>{label}</span>
          </span>
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
  const stretchRef = useRef<HTMLSpanElement>(null);
  const holeRef = useRef<HTMLSpanElement>(null);
  const unstretchRef = useRef<HTMLSpanElement>(null);
  const shownTarget = useRef(target);
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
  const hole = useMemo(() => size ? buildHole(size) : null, [size]);

  useLayoutEffect(() => {
    const layers = [[stretchRef.current, STRETCH_X, STRETCH_Y], [holeRef.current, STRETCH_X, STRETCH_Y], [unstretchRef.current, 1 / STRETCH_X, 1 / STRETCH_Y]] as const;
    const moved = shownTarget.current !== target;
    shownTarget.current = target;
    const node = stretchRef.current;
    if (!node) return;
    if (reducedMotion) {
      for (const [layer] of layers) for (const animation of layer?.getAnimations() ?? []) animation.cancel();
      return;
    }
    if (!moved || document.visibilityState === "hidden" || node.getClientRects().length === 0) return;
    const starts = layers.map(([layer]) => layer ? getComputedStyle(layer).transform : "none");
    layers.forEach(([layer, x, y], index) => {
      if (!layer) return;
      for (const animation of layer.getAnimations()) animation.cancel();
      layer.animate([
        { transform: starts[index] === "none" ? "scale(1)" : starts[index], easing: "cubic-bezier(.2, 0, .4, 1)" },
        { transform: `scale(${x}, ${y})`, offset: .15, easing: "cubic-bezier(.4, 0, .4, 1)" },
        { transform: "scale(1)", offset: .6 },
        { transform: "scale(1)" },
      ], { duration: TRAVEL_MS });
    });
  }, [target, reducedMotion]);

  useLayoutEffect(() => {
    const nav = windowRef.current?.parentElement;
    if (!nav || reducedMotion) return;
    let pointer: number | null = null;
    let pressedAt = 0;
    let release = 0;
    const press = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0 || !(event.target instanceof Element)) return;
      if (event.target.closest("button")?.parentElement !== nav) return;
      window.clearTimeout(release);
      pointer = event.pointerId;
      pressedAt = event.timeStamp;
      nav.setAttribute("data-lens-pressed", "");
    };
    const lift = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return;
      pointer = null;
      release = window.setTimeout(() => nav.removeAttribute("data-lens-pressed"), Math.max(0, MIN_PRESS_MS - (event.timeStamp - pressedAt)));
    };
    const drop = () => {
      pointer = null;
      window.clearTimeout(release);
      nav.removeAttribute("data-lens-pressed");
    };
    const hide = () => { if (document.visibilityState === "hidden") drop(); };
    nav.addEventListener("pointerdown", press, { passive: true });
    window.addEventListener("pointerup", lift, { passive: true });
    window.addEventListener("pointercancel", lift, { passive: true });
    document.addEventListener("pointerup", lift, { capture: true, passive: true });
    document.addEventListener("pointercancel", lift, { capture: true, passive: true });
    window.addEventListener("blur", drop);
    document.addEventListener("visibilitychange", hide);
    return () => {
      nav.removeEventListener("pointerdown", press);
      window.removeEventListener("pointerup", lift);
      window.removeEventListener("pointercancel", lift);
      document.removeEventListener("pointerup", lift, { capture: true });
      document.removeEventListener("pointercancel", lift, { capture: true });
      window.removeEventListener("blur", drop);
      document.removeEventListener("visibilitychange", hide);
      window.clearTimeout(release);
      nav.removeAttribute("data-lens-pressed");
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

  const ready = filter !== null && hole !== null;
  useLayoutEffect(() => {
    onReadyChange(ready);
  }, [ready, onReadyChange]);
  useLayoutEffect(() => () => onReadyChange(false), [onReadyChange]);

  const slide = {
    transform: `translateX(${target * 100}%)`,
    "--lens-travel": `${TRAVEL_MS}ms`,
  } as CSSProperties;
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
          <span className={`${styles.cutout} ${styles.lift} absolute`}>
            <span ref={holeRef} className={`${styles.hole} absolute inset-0`} style={{ maskImage: hole, WebkitMaskImage: hole }}>
              <span ref={unstretchRef} className="absolute inset-0">
                <span className={`${styles.unlift} absolute inset-0`}>
                  <LensTrack items={items} target={target} className={`${styles.cutoutTrack} absolute`} tone={styles.unselected} />
                </span>
              </span>
            </span>
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
        <span ref={stretchRef} className="absolute inset-0">
          <span className={`${styles.glass} ${styles.lift} absolute inset-0`}>
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
            <span className={`${styles.refraction} absolute inset-0`} style={filter ? { filter: `url(#${filter.id})` } : undefined}>
              <LensTrack items={items} target={target} className="absolute inset-y-0 start-0 w-[200%]" tone={styles.selected} />
            </span>
            {filter ? (
              <span
                className={`${styles.specular} absolute inset-0`}
                style={{ maskImage: `url(${filter.specular})`, WebkitMaskImage: `url(${filter.specular})` }}
              />
            ) : null}
          </span>
        </span>
      </span>
    </>
  );
}
