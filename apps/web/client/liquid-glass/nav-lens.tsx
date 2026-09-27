"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion, useMotionValue, useTransform } from "motion/react";
import { shouldRefractNavRim, type EngineBrand } from "./lens-gate";
import { generateLensMaps } from "./lens-map";
import { createRecentCache } from "./recent-cache";
import { readNavLensEnvironment, type NavLensProps } from "./use-nav-lens";
import styles from "./nav-lens.module.css";

type LensSize = { width: number; height: number; ratio: number };
type LensImages = { displacement: string; specular: string; scale: number; margin: number };
type LensFilter = LensImages & LensSize & { id: string };
type RimImages = { displacement: string; core: string; scale: number };
type RimFilter = RimImages & LensSize & { id: string };

const BEZEL = 10;
const THICKNESS = 10;
const NEUTRAL = "rgb(128 128 128)";
const SPECULAR_GAIN = 2.5;
const RIM_BEZEL = 16;
const RIM_THICKNESS = 14;
const RIM_SOFTEN = 1.5;
const RIM_FROST = 24;
const RIM_CORE_INSET = 7;
const RIM_CORE_FEATHER = 4;
const cache = createRecentCache<LensImages>(4);
const rimCache = createRecentCache<RimImages>(4);

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
  const maps = generateLensMaps({ width, height, radius: height / 2 }, { pixelRatio: ratio, bezel: RIM_BEZEL, thickness: RIM_THICKNESS });
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

function readRatio() {
  return Math.max(1, Math.min(2, window.devicePixelRatio || 1));
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

export function NavLens({ items, activeIndex, direction, reducedMotion, onStatusChange }: NavLensProps) {
  const windowRef = useRef<HTMLSpanElement>(null);
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
  const target = activeIndex > 0 ? (direction === "rtl" ? -1 : 1) : 0;
  const windowX = useMotionValue(`${target * 100}%`);
  const trackX = useTransform(windowX, (value) => `${Number.parseFloat(value) * -0.5}%`);
  const [restingTarget, setRestingTarget] = useState(target);

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

  useLayoutEffect(() => {
    const node = windowRef.current;
    const nav = node?.parentElement;
    if (!node || !nav || !size) return;
    const { width, height } = node.getBoundingClientRect();
    const holes = Array.from(nav.querySelectorAll<HTMLElement>(":scope > button > span"), (content) => {
      const tab = content.parentElement;
      return { content, origin: (tab ? tab.offsetLeft + tab.clientLeft : 0) + content.offsetLeft - node.offsetLeft };
    });
    const place = (value: string) => {
      const x = Number.parseFloat(value) / 100 * width;
      for (const { content, origin } of holes) content.style.setProperty("--nav-lens-x", `${x - origin}px`);
    };
    nav.style.setProperty("--nav-lens-width", `${width}px`);
    nav.style.setProperty("--nav-lens-height", `${height}px`);
    place(windowX.get());
    const stop = windowX.on("change", place);
    return () => {
      stop();
      nav.style.removeProperty("--nav-lens-width");
      nav.style.removeProperty("--nav-lens-height");
      for (const { content } of holes) content.style.removeProperty("--nav-lens-x");
    };
  }, [size, windowX]);

  const ready = filter !== null;
  const status = !ready ? null : reducedMotion || restingTarget === target ? "resting" : "moving";
  useLayoutEffect(() => {
    onStatusChange(status);
  }, [status, onStatusChange]);
  useLayoutEffect(() => () => onStatusChange(null), [onStatusChange]);

  return (
    <motion.span
      ref={windowRef}
      aria-hidden="true"
      inert
      data-navigation-lens={ready ? "ready" : "pending"}
      className={`${styles.window} pointer-events-none absolute inset-y-1 start-1 z-20 select-none`}
      style={{ x: windowX }}
      animate={{ x: `${target * 100}%` }}
      transition={reducedMotion ? { duration: 0 } : { type: "spring", visualDuration: 0.16, bounce: 0.1 }}
      onAnimationComplete={() => setRestingTarget(target)}
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
      <span className={`${styles.refraction} absolute inset-0`} style={filter ? { filter: `url(#${filter.id})` } : undefined}>
        <motion.span className="absolute inset-y-0 start-0 grid w-[200%] grid-cols-2" style={{ x: trackX }}>
          {items.map(({ id, label, Icon }) => (
            <span key={id} className={`${styles.tab} flex min-w-0 items-center justify-center px-2`}>
              <span className={`${styles.content} flex min-w-0 w-full flex-col items-center justify-center gap-0.5`}>
                <Icon className={`${styles.icon} size-5.5`} aria-hidden="true" />
                <span className={`${styles.label} block max-w-full truncate`}>{label}</span>
              </span>
            </span>
          ))}
        </motion.span>
      </span>
      {filter ? (
        <span
          className={`${styles.specular} absolute inset-0`}
          style={{ maskImage: `url(${filter.specular})`, WebkitMaskImage: `url(${filter.specular})` }}
        />
      ) : null}
    </motion.span>
  );
}
