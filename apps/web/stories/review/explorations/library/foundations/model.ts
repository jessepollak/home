import { componentSourceSet, componentSources, globalsSource } from "./sources";
import { probeThemes } from "./probe";
import { blockDeclarations, colorTokens, themeScale } from "./tokens";
import { motionUsage, radiusUsage, spacingUsage, typeUsage } from "./usage";

export type FoundationId = "foundations/color" | "foundations/type" | "foundations/radius-spacing" | "foundations/motion";
const motion = motionUsage(componentSources);
const themeNames = [...new Set([...blockDeclarations(globalsSource, ":root"), ...blockDeclarations(globalsSource, ".dark")]
  .map((declaration) => declaration.name))];
const colorSnapshot = typeof document === "undefined" ? null : probeThemes(themeNames);
const spacingNames = themeScale(globalsSource, "spacing").map((declaration) => declaration.name);

export const foundations = {
  colors: colorTokens(globalsSource, undefined, colorSnapshot?.status === "measured" ? Object.values(colorSnapshot.values) : []),
  themeNames,
  type: typeUsage(componentSources),
  radius: { scale: themeScale(globalsSource, "radius"), usage: radiusUsage(componentSources) },
  spacing: { named: themeScale(globalsSource, "spacing"), usage: spacingUsage(componentSources, spacingNames) },
  motion,
  scanned: componentSources.length,
  sourcesAvailable: componentSourceSet.status === "available",
};

export const foundationPages: { id: FoundationId; name: string; kind: string }[] = [
  { id: "foundations/color", name: "Color", kind: `${foundations.colors.length} tokens` },
  { id: "foundations/type", name: "Type", kind: foundations.sourcesAvailable ? `${foundations.type.sizes.length} sizes` : "Sources unavailable" },
  { id: "foundations/radius-spacing", name: "Radius & spacing",
    kind: foundations.sourcesAvailable ? `${foundations.radius.usage.length + foundations.spacing.usage.length} steps` : "Sources unavailable" },
  { id: "foundations/motion", name: "Motion", kind: foundations.sourcesAvailable ? `${foundations.motion.uses.length} utilities` : "Sources unavailable" },
];

export function isFoundation(id: string | undefined): id is FoundationId {
  return foundationPages.some((page) => page.id === id);
}
