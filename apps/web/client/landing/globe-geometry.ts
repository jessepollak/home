import coordinates from "./globe-country-coordinates.json";
import { presentationRegions, regionIds } from "@/config/regions";

export type GlobeCountry = {
  countryCode: string;
  countryName: string;
  currency: { code: string | null; name: string };
};

export type GlobePoint = GlobeCountry & {
  longitude: number;
  latitude: number;
};

export type GlobeRoute = {
  id: string;
  from: GlobePoint;
  to: GlobePoint;
  phase: number;
};

export type ProjectedGlobeRoute = {
  path: string;
  pulse: ReturnType<typeof projectCountry>;
  arrival: ReturnType<typeof projectCountry>;
  arrivalProgress: number;
};

export const INITIAL_LONGITUDE = -28;
export const VIEW_LATITUDE = 12;
export const GLOBE_RADIUS = 44;
export const NETWORK_CYCLE_MS = 6_800;
const ROUTE_SAMPLES = 20;
const RAD = Math.PI / 180;

/** Stable illustrative links only. They are not transactions or verified corridors. */
const illustrativeRouteSpecs = [
  ["US", "GB"], ["US", "BR"], ["CA", "FR"], ["MX", "CO"],
  ["BR", "PT"], ["AR", "ES"], ["NG", "GB"], ["ZA", "DE"],
  ["TR", "DE"], ["SG", "AU"], ["SG", "ID"], ["AU", "NZ"],
] as const;

/** Presentation profiles, deliberately not a claim about product eligibility. */
export function configuredGlobeCountries(): GlobeCountry[] {
  return regionIds.flatMap((id) => {
    const region = presentationRegions[id];
    return region.countryCode ? [region as GlobeCountry] : [];
  });
}

export function locateCountries(countries: readonly GlobeCountry[]): GlobePoint[] {
  const seen = new Set<string>();
  return countries.flatMap((country) => {
    const code = country.countryCode.trim().toUpperCase();
    const position = (coordinates as Record<string, number[]>)[code];
    if (!position || seen.has(code)) return [];
    seen.add(code);
    return [{ ...country, countryCode: code, longitude: position[0], latitude: position[1] }];
  });
}

/** Right-handed unit sphere: +Y north, +Z at the prime meridian. */
export function geographicVector(longitude: number, latitude: number) {
  const lon = longitude * RAD;
  const lat = latitude * RAD;
  return [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)] as const;
}

function projectVector(
  [sourceX, sourceY, sourceZ]: readonly number[],
  viewLongitude: number,
  elevation = 1,
) {
  const longitude = viewLongitude * RAD;
  const x = Math.cos(longitude) * sourceX - Math.sin(longitude) * sourceZ;
  const z = Math.sin(longitude) * sourceX + Math.cos(longitude) * sourceZ;
  const tilt = VIEW_LATITUDE * RAD;
  const screenY = sourceY * Math.cos(tilt) - z * Math.sin(tilt);
  const depth = sourceY * Math.sin(tilt) + z * Math.cos(tilt);
  return {
    x: 50 + GLOBE_RADIUS * x * elevation,
    y: 50 - GLOBE_RADIUS * screenY * elevation,
    depth,
    visible: depth > 0.045,
  };
}

/** Orthographic projection shared by the GPU and static markers. */
export function projectCountry(longitude: number, latitude: number, viewLongitude = INITIAL_LONGITUDE) {
  return projectVector(geographicVector(longitude, latitude), viewLongitude);
}

export function configureGlobeRoutes(points: readonly GlobePoint[]): GlobeRoute[] {
  const byCode = new Map(points.map((point) => [point.countryCode, point]));
  return illustrativeRouteSpecs.flatMap(([fromCode, toCode], index) => {
    const from = byCode.get(fromCode);
    const to = byCode.get(toCode);
    return from && to ? [{ id: `${fromCode}-${toCode}`, from, to, phase: index / illustrativeRouteSpecs.length }] : [];
  });
}

function routeVector(from: readonly number[], to: readonly number[], progress: number) {
  const dot = Math.max(-1, Math.min(1, from[0]! * to[0]! + from[1]! * to[1]! + from[2]! * to[2]!));
  const angle = Math.acos(dot);
  if (angle < 0.0001) return from as readonly [number, number, number];
  const sinAngle = Math.sin(angle);
  const fromWeight = Math.sin((1 - progress) * angle) / sinAngle;
  const toWeight = Math.sin(progress * angle) / sinAngle;
  return [
    from[0]! * fromWeight + to[0]! * toWeight,
    from[1]! * fromWeight + to[1]! * toWeight,
    from[2]! * fromWeight + to[2]! * toWeight,
  ] as const;
}

/** Projects bounded great-circle samples and culls every back-facing segment. */
export function projectGlobeRoute(
  route: GlobeRoute,
  viewLongitude: number,
  cycleProgress = route.phase,
): ProjectedGlobeRoute {
  const from = geographicVector(route.from.longitude, route.from.latitude);
  const to = geographicVector(route.to.longitude, route.to.latitude);
  const segments: string[] = [];
  let drawing = false;
  for (let index = 0; index <= ROUTE_SAMPLES; index++) {
    const progress = index / ROUTE_SAMPLES;
    const elevation = 1 + Math.sin(progress * Math.PI) * 0.075;
    const point = projectVector(routeVector(from, to, progress), viewLongitude, elevation);
    if (!point.visible) {
      drawing = false;
      continue;
    }
    segments.push(`${drawing ? "L" : "M"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`);
    drawing = true;
  }
  const progress = ((cycleProgress % 1) + 1) % 1;
  const pulse = projectVector(
    routeVector(from, to, progress),
    viewLongitude,
    1 + Math.sin(progress * Math.PI) * 0.075,
  );
  const arrival = projectCountry(route.to.longitude, route.to.latitude, viewLongitude);
  const arrivalProgress = progress >= 0.88 ? (progress - 0.88) / 0.12 : 0;
  return { path: segments.join(" "), pulse, arrival, arrivalProgress };
}

export const POPOVER_MIN_DWELL_MS = 1_700;
const POPOVER_CENTRAL_DISTANCE = 24;
const POPOVER_HYSTERESIS = 4;

export type GlobePopoverSelection = {
  country: GlobePoint;
  position: ReturnType<typeof projectCountry>;
};

/** Selects one sourced, front-facing profile without oscillating between nearby markers. */
export function selectGlobePopoverCountry(
  points: readonly GlobePoint[],
  viewLongitude: number,
  currentCountryCode: string | null = null,
  elapsedSinceChange = Number.POSITIVE_INFINITY,
): GlobePopoverSelection | null {
  const candidates = points.flatMap((country) => {
    const position = projectCountry(country.longitude, country.latitude, viewLongitude);
    const distance = Math.abs(position.x - 50) + Math.abs(position.y - 50) * 0.06;
    return position.visible && position.depth > 0.55 && distance <= POPOVER_CENTRAL_DISTANCE
      ? [{ country, position, distance }]
      : [];
  });

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.distance - b.distance || a.country.countryCode.localeCompare(b.country.countryCode));
  const nearest = candidates[0]!;
  const current = currentCountryCode
    ? candidates.find((candidate) => candidate.country.countryCode === currentCountryCode)
    : undefined;

  if (
    current &&
    (elapsedSinceChange < POPOVER_MIN_DWELL_MS ||
      current.distance <= nearest.distance + POPOVER_HYSTERESIS)
  ) {
    return current;
  }

  return nearest;
}

export function countryFlag(countryCode: string): string {
  const code = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(
    ...Array.from(code, (letter) => 127397 + letter.charCodeAt(0)),
  );
}

export function shouldAnimateGlobe(reducedMotion: boolean, userPlaying: boolean | null) {
  return userPlaying ?? !reducedMotion;
}
