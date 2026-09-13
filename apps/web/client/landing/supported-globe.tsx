"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import {
  configureGlobeRoutes,
  configuredGlobeCountries,
  countryFlag,
  INITIAL_LONGITUDE,
  locateCountries,
  NETWORK_CYCLE_MS,
  projectCountry,
  projectGlobeRoute,
  selectGlobePopoverCountry,
  shouldAnimateGlobe,
  type GlobeCountry,
  type GlobePoint,
  type GlobePopoverSelection,
} from "./globe-geometry";
import type { GlobeRenderer } from "./globe-renderer";
import styles from "./supported-globe.module.css";

export type { GlobeCountry } from "./globe-geometry";

export type SupportedGlobeProps = {
  className?: string;
  /** Defaults to every configured non-neutral presentation profile. ISO alpha-2 codes. */
  countries?: readonly GlobeCountry[];
};

type RouteNodes = {
  path: SVGPathElement | null;
  pulse: SVGCircleElement | null;
  ripple: SVGCircleElement | null;
};

const defaultCountries = configuredGlobeCountries();
const motionQuery = "(prefers-reduced-motion: reduce)";
function subscribeMotion(callback: () => void) {
  const media = window.matchMedia(motionQuery);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
function motionSnapshot() { return window.matchMedia(motionQuery).matches; }
function serverMotionSnapshot() { return true; }

function selectionForPoint(point: GlobePoint, longitude: number): GlobePopoverSelection {
  return { country: point, position: projectCountry(point.longitude, point.latitude, longitude) };
}

/** A centerpiece only: composition, headline and sign-in remain with the landing. */
export function SupportedGlobe({ className, countries = defaultCountries }: SupportedGlobeProps) {
  const descriptionId = useId();
  const motionId = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const markerRefs = useRef(new Map<string, SVGCircleElement>());
  const countryButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const routeRefs = useRef(new Map<string, RouteNodes>());
  const popoverRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<GlobeRenderer | null>(null);
  const motionRef = useRef(false);
  const longitudeRef = useRef(INITIAL_LONGITUDE);
  const points = useMemo(() => locateCountries(countries), [countries]);
  const routes = useMemo(() => configureGlobeRoutes(points), [points]);
  const initialPopover = useMemo(
    () => selectGlobePopoverCountry(points, INITIAL_LONGITUDE),
    [points],
  );
  const pointsRef = useRef(points);
  const routesRef = useRef(routes);
  const activeCountryRef = useRef<string | null>(null);
  const selectedCountryRef = useRef(initialPopover?.country.countryCode ?? null);
  const selectedAtRef = useRef(0);
  const reducedMotion = useSyncExternalStore(subscribeMotion, motionSnapshot, serverMotionSnapshot);
  const [selectedPopover, setSelectedPopover] = useState<GlobePopoverSelection | null>(initialPopover);
  const [activeCountryCode, setActiveCountryCode] = useState<string | null>(null);
  const [rovingCountryCode, setRovingCountryCode] = useState<string | null>(initialPopover?.country.countryCode ?? points[0]?.countryCode ?? null);
  const [userPlaying, setUserPlaying] = useState<boolean | null>(null);
  const [status, setStatus] = useState<"static" | "ready" | "unavailable">("static");
  const requestedPlaying = shouldAnimateGlobe(reducedMotion, userPlaying);
  const playing = requestedPlaying && activeCountryCode === null;
  const selectedCountry = selectedPopover?.country ?? null;

  useEffect(() => {
    pointsRef.current = points;
    routesRef.current = routes;
    const activePoint = activeCountryRef.current
      ? points.find((point) => point.countryCode === activeCountryRef.current)
      : undefined;
    const selection = activePoint
      ? selectionForPoint(activePoint, longitudeRef.current)
      : selectGlobePopoverCountry(points, longitudeRef.current);
    selectedCountryRef.current = selection?.country.countryCode ?? null;
    selectedAtRef.current = performance.now();
    setSelectedPopover(selection);
    if (!activePoint) setRovingCountryCode(selection?.country.countryCode ?? points[0]?.countryCode ?? null);
  }, [points, routes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    let cancelled = false;
    let renderer: GlobeRenderer | undefined;

    function positionPopover(selection: GlobePopoverSelection | null) {
      const now = performance.now();
      const nextCode = selection?.country.countryCode ?? null;
      if (selection) {
        popoverRef.current?.style.setProperty("--popover-x", `${selection.position.x}%`);
        popoverRef.current?.style.setProperty("--popover-y", `${selection.position.y}%`);
        popoverRef.current?.removeAttribute("hidden");
      } else {
        popoverRef.current?.setAttribute("hidden", "");
      }
      if (nextCode !== selectedCountryRef.current) {
        selectedCountryRef.current = nextCode;
        selectedAtRef.current = now;
        setSelectedPopover(selection);
        if (!activeCountryRef.current) setRovingCountryCode(nextCode);
      }
    }

    function project(longitude: number, frameTime = performance.now()) {
      longitudeRef.current = longitude;
      for (const point of pointsRef.current) {
        const position = projectCountry(point.longitude, point.latitude, longitude);
        const marker = markerRefs.current.get(point.countryCode);
        marker?.setAttribute("cx", position.x.toFixed(3));
        marker?.setAttribute("cy", position.y.toFixed(3));
        marker?.setAttribute("visibility", position.visible ? "visible" : "hidden");
        const button = countryButtonRefs.current.get(point.countryCode);
        button?.style.setProperty("--country-x", `${position.x.toFixed(3)}%`);
        button?.style.setProperty("--country-y", `${position.y.toFixed(3)}%`);
        button?.setAttribute("data-visible", position.visible && position.depth > 0.12 ? "true" : "false");
      }
      for (const route of routesRef.current) {
        const progress = motionRef.current
          ? frameTime / NETWORK_CYCLE_MS + route.phase
          : route.phase;
        const projection = projectGlobeRoute(route, longitude, progress);
        const nodes = routeRefs.current.get(route.id);
        nodes?.path?.setAttribute("d", projection.path);
        nodes?.path?.style.setProperty(
          "--route-opacity",
          motionRef.current ? `${0.28 + Math.sin(progress * Math.PI * 2) * 0.07}` : "0.27",
        );
        if (nodes?.pulse) {
          nodes.pulse.setAttribute("cx", projection.pulse.x.toFixed(2));
          nodes.pulse.setAttribute("cy", projection.pulse.y.toFixed(2));
          nodes.pulse.setAttribute("visibility", motionRef.current && projection.pulse.visible ? "visible" : "hidden");
        }
        if (nodes?.ripple) {
          nodes.ripple.setAttribute("cx", projection.arrival.x.toFixed(2));
          nodes.ripple.setAttribute("cy", projection.arrival.y.toFixed(2));
          nodes.ripple.setAttribute("r", (0.8 + projection.arrivalProgress * 2.6).toFixed(2));
          nodes.ripple.setAttribute(
            "opacity",
            motionRef.current && projection.arrival.visible && projection.arrivalProgress > 0
              ? (0.55 * (1 - projection.arrivalProgress)).toFixed(2)
              : "0",
          );
        }
      }
      const activePoint = activeCountryRef.current
        ? pointsRef.current.find((point) => point.countryCode === activeCountryRef.current)
        : undefined;
      const activeSelection = activePoint ? selectionForPoint(activePoint, longitude) : null;
      const activeIsVisible = Boolean(
        activeSelection?.position.visible && activeSelection.position.depth > 0.12,
      );
      if (activePoint && !activeIsVisible) {
        const activeButton = countryButtonRefs.current.get(activePoint.countryCode);
        if (activeButton === document.activeElement) {
          stage!.focus({ preventScroll: true });
        }
        activeCountryRef.current = null;
        setActiveCountryCode(null);
        const fallback = selectGlobePopoverCountry(pointsRef.current, longitude);
        setRovingCountryCode(fallback?.country.countryCode ?? pointsRef.current[0]?.countryCode ?? null);
        positionPopover(fallback);
      } else {
        positionPopover(activeIsVisible
          ? activeSelection
          : selectGlobePopoverCountry(
              pointsRef.current,
              longitude,
              selectedCountryRef.current,
              performance.now() - selectedAtRef.current,
            ));
      }
    }

    function unavailable() {
      if (cancelled) return;
      rendererRef.current = null;
      project(INITIAL_LONGITUDE);
      setStatus("unavailable");
    }

    // Static server HTML stays useful; GPU code isn't a prerequisite to sign-in.
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      import("./globe-renderer").then(({ createGlobeRenderer }) => {
        if (cancelled) return;
        renderer = createGlobeRenderer(canvas!, stage!, project, unavailable);
        rendererRef.current = renderer;
        renderer.setMotion(motionRef.current);
        setStatus("ready");
      }).catch(unavailable);
    });
    observer.observe(stage);
    return () => {
      cancelled = true;
      observer.disconnect();
      renderer?.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    motionRef.current = playing;
    rendererRef.current?.setMotion(status === "ready" && playing);
  }, [status, playing]);

  function activateCountry(point: GlobePoint) {
    activeCountryRef.current = point.countryCode;
    setActiveCountryCode(point.countryCode);
    setRovingCountryCode(point.countryCode);
    const selection = selectionForPoint(point, longitudeRef.current);
    selectedCountryRef.current = point.countryCode;
    selectedAtRef.current = 0;
    setSelectedPopover(selection);
  }

  function clearActiveCountry() {
    if (!activeCountryRef.current) return;
    activeCountryRef.current = null;
    setActiveCountryCode(null);
    const selection = selectGlobePopoverCountry(points, longitudeRef.current);
    selectedCountryRef.current = selection?.country.countryCode ?? null;
    selectedAtRef.current = 0;
    setSelectedPopover(selection);
    setRovingCountryCode(selection?.country.countryCode ?? points[0]?.countryCode ?? null);
  }

  function focusAdjacentCountry(current: GlobePoint, direction: -1 | 1) {
    const visible = points.filter((point) => {
      const position = projectCountry(point.longitude, point.latitude, longitudeRef.current);
      return position.visible && position.depth > 0.12;
    }).sort((a, b) => a.longitude - b.longitude || a.latitude - b.latitude);
    const index = visible.findIndex((point) => point.countryCode === current.countryCode);
    const next = visible[(Math.max(0, index) + direction + visible.length) % visible.length];
    if (!next) return;
    activateCountry(next);
    countryButtonRefs.current.get(next.countryCode)?.focus();
  }

  return (
    <figure className={[styles.globe, className].filter(Boolean).join(" ")} data-renderer={status}>
      <div ref={stageRef} className={styles.stage}
        role={status === "ready" ? "group" : "img"}
        aria-label="Interactive world with illustrative money connections"
        aria-describedby={`${descriptionId} ${motionId}`}
        tabIndex={status === "ready" ? 0 : undefined}
        aria-keyshortcuts={status === "ready" ? "Space ArrowLeft ArrowRight Escape" : undefined}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) clearActiveCountry();
        }}
        onKeyDown={(event) => {
          if (status !== "ready" || event.altKey || event.ctrlKey || event.metaKey) return;
          if (event.key === " ") {
            event.preventDefault();
            if (!event.repeat) setUserPlaying(!requestedPlaying);
          } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            rendererRef.current?.rotate(event.key === "ArrowLeft" ? 12 : -12);
          } else if (event.key === "Escape") {
            event.preventDefault();
            clearActiveCountry();
            event.currentTarget.focus();
          }
        }}>
        <div className={styles.staticGlobe} hidden={status === "ready"} aria-hidden="true" />
        <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true"
          style={{ visibility: status === "ready" ? "visible" : "hidden" }} />
        <svg className={styles.network} viewBox="0 0 100 100" aria-hidden="true">
          {routes.map((route) => {
            const projection = projectGlobeRoute(route, INITIAL_LONGITUDE);
            const highlighted = activeCountryCode === route.from.countryCode || activeCountryCode === route.to.countryCode;
            return <g key={route.id} data-route={route.id} data-highlighted={highlighted ? "true" : "false"}>
              <path ref={(node) => {
                const current = routeRefs.current.get(route.id) ?? { path: null, pulse: null, ripple: null };
                current.path = node;
                routeRefs.current.set(route.id, current);
              }} className={styles.route} d={projection.path} />
              <circle ref={(node) => {
                const current = routeRefs.current.get(route.id) ?? { path: null, pulse: null, ripple: null };
                current.pulse = node;
                routeRefs.current.set(route.id, current);
              }} className={styles.pulse} cx={projection.pulse.x} cy={projection.pulse.y} r=".62" visibility="hidden" />
              <circle ref={(node) => {
                const current = routeRefs.current.get(route.id) ?? { path: null, pulse: null, ripple: null };
                current.ripple = node;
                routeRefs.current.set(route.id, current);
              }} className={styles.ripple} cx={projection.arrival.x} cy={projection.arrival.y} r=".8" opacity="0" />
            </g>;
          })}
        </svg>
        <svg className={styles.markers} viewBox="0 0 100 100" aria-hidden="true">
          {points.map((point) => {
            const position = projectCountry(point.longitude, point.latitude);
            return <circle key={point.countryCode} data-country={point.countryCode}
              ref={(node) => {
                if (node) markerRefs.current.set(point.countryCode, node);
                else markerRefs.current.delete(point.countryCode);
              }}
              cx={position.x.toFixed(3)} cy={position.y.toFixed(3)} r=".48"
              visibility={position.visible ? "visible" : "hidden"}
              fill="#0000FF" stroke="white" strokeWidth=".22" />;
          })}
        </svg>
        <div className={styles.countryTargets} data-interactive={status === "ready" ? "true" : "false"}>
          {points.map((point) => {
            const position = projectCountry(point.longitude, point.latitude);
            const currency = point.currency.code ?? point.currency.name;
            return <button
              key={point.countryCode}
              ref={(node) => {
                if (node) countryButtonRefs.current.set(point.countryCode, node);
                else countryButtonRefs.current.delete(point.countryCode);
              }}
              type="button"
              className={styles.countryTarget}
              style={{ "--country-x": `${position.x.toFixed(3)}%`, "--country-y": `${position.y.toFixed(3)}%` } as CountryTargetStyle}
              data-visible={position.visible && position.depth > 0.12 ? "true" : "false"}
              data-active={activeCountryCode === point.countryCode ? "true" : "false"}
              aria-pressed={activeCountryCode === point.countryCode}
              tabIndex={status === "ready" && rovingCountryCode === point.countryCode ? 0 : -1}
              aria-hidden={status === "ready" ? undefined : true}
              aria-label={`${point.countryName}, ${currency}. Highlight illustrative connections.`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => activateCountry(point)}
              onFocus={() => activateCountry(point)}
              onKeyDown={(event) => {
                if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                  event.preventDefault();
                  event.stopPropagation();
                  focusAdjacentCountry(point, event.key === "ArrowUp" ? -1 : 1);
                } else if (event.key === " " || event.key === "Enter") {
                  event.preventDefault();
                  event.stopPropagation();
                  activateCountry(point);
                }
              }}
            />;
          })}
        </div>
        {selectedCountry ? (
          <div
            ref={popoverRef}
            className={styles.popover}
            style={popoverStyle(selectedPopover?.position ?? null)}
          >
            <span className={styles.flag} aria-hidden="true">
              {countryFlag(selectedCountry.countryCode)}
            </span>
            <span>
              <strong>{selectedCountry.countryName}</strong>
              <small>
                {selectedCountry.currency.code ?? selectedCountry.currency.name}
                {selectedCountry.currency.code ? ` · ${selectedCountry.currency.name}` : ""}
              </small>
            </span>
          </div>
        ) : null}
      </div>
      <div className={styles.srOnly}>
        <p id={descriptionId}>
          {countries.length} country &amp; currency profiles connected by a small illustrative route set.
          {status === "ready" && " Drag horizontally to spin. Space pauses or resumes rotation; Left and Right arrows rotate the globe. Tab to a country point; Up and Down arrows move between visible country points."}
        </p>
        <p id={motionId} role="status">
          {status === "ready" ? playing ? "Globe and route motion on." : "Globe and route motion paused." : "Static globe and route view."}
        </p>
      </div>
    </figure>
  );
}

type PopoverStyle = CSSProperties & {
  "--popover-x": string;
  "--popover-y": string;
};

type CountryTargetStyle = CSSProperties & {
  "--country-x": string;
  "--country-y": string;
};

function popoverStyle(position: GlobePopoverSelection["position"] | null): PopoverStyle {
  return {
    "--popover-x": `${position?.x ?? 50}%`,
    "--popover-y": `${position?.y ?? 50}%`,
  };
}
