import { confirmedCandidates } from "./candidates";
import { componentCandidateSet, globalsSource } from "./sources";
import { probeThemes } from "./probe";
import { blockDeclarations, colorTokens, themeScale } from "./tokens";
import { elevationUsage, motionUsage, radiusUsage, spacingUsage, stateUsage, typeUsage } from "./usage";

export type FoundationId = "foundations/color" | "foundations/type" | "foundations/radius-spacing" | "foundations/motion"
  | "foundations/elevation" | "foundations/states";
const candidateSnapshot = typeof document === "undefined" ? null : confirmedCandidates(
  componentCandidateSet.status === "available" ? componentCandidateSet.files : null,
);
const candidates = candidateSnapshot?.files ?? [];
const motion = motionUsage(candidates);
const STATE_COMPONENTS = ["button", "item", "toggle", "input", "select", "combobox"];
const themeNames = [...new Set([...blockDeclarations(globalsSource, ":root"), ...blockDeclarations(globalsSource, ".dark")]
  .map((declaration) => declaration.name))];
const colorSnapshot = typeof document === "undefined" ? null : probeThemes(themeNames);
const spacingNames = themeScale(globalsSource, "spacing").map((declaration) => declaration.name);

export const foundations = {
  colors: colorTokens(globalsSource, undefined, colorSnapshot?.status === "measured" ? Object.values(colorSnapshot.values) : []),
  themeNames,
  type: typeUsage(candidates),
  radius: { scale: themeScale(globalsSource, "radius"), usage: radiusUsage(candidates) },
  spacing: { named: themeScale(globalsSource, "spacing"), usage: spacingUsage(candidates, spacingNames) },
  motion,
  elevation: elevationUsage(candidates),
  states: stateUsage(candidates, STATE_COMPONENTS),
  scanned: componentCandidateSet.files.length,
  sourcesAvailable: componentCandidateSet.status === "available",
  candidatesAvailable: candidateSnapshot?.status === "available",
};

export const foundationPages: { id: FoundationId; name: string; kind: string }[] = [
  { id: "foundations/color", name: "Color", kind: `${foundations.colors.length} tokens` },
  { id: "foundations/type", name: "Type", kind: foundations.sourcesAvailable && foundations.candidatesAvailable ? `${foundations.type.sizes.length} sizes` : "Counts unavailable" },
  { id: "foundations/radius-spacing", name: "Radius & spacing",
    kind: foundations.sourcesAvailable && foundations.candidatesAvailable ? `${foundations.radius.usage.length + foundations.spacing.usage.length} steps` : "Counts unavailable" },
  { id: "foundations/motion", name: "Motion", kind: foundations.sourcesAvailable && foundations.candidatesAvailable ? `${foundations.motion.uses.length} utilities` : "Counts unavailable" },
  { id: "foundations/elevation", name: "Elevation", kind: foundations.sourcesAvailable && foundations.candidatesAvailable
    ? `${foundations.elevation.shadows.length + foundations.elevation.rings.length} utilities` : "Counts unavailable" },
  { id: "foundations/states", name: "States", kind: foundations.sourcesAvailable && foundations.candidatesAvailable
    ? `${new Set(foundations.states.flatMap((use) => use.classes.map(({ name }) => name))).size} utilities` : "Counts unavailable" },
];

export function isFoundation(id: string | undefined): id is FoundationId {
  return foundationPages.some((page) => page.id === id);
}
