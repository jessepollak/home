import { componentSources, globalsSource, ownedSources } from "./sources";
import { blockDeclarations, colorTokens, themeScale } from "./tokens";
import { motionUsage, radiusUsage, spacingUsage, typeUsage, type MotionUse } from "./usage";

export type FoundationId = "foundations/color" | "foundations/type" | "foundations/radius-spacing" | "foundations/motion";
export type Timing = { duration: number | null; easing: string | null; uses: MotionUse[] };

function timings(uses: MotionUse[]): Timing[] {
  const groups = new Map<string, Timing>();
  for (const use of uses) {
    const key = `${use.duration ?? "default"}|${use.easing ?? "default"}`;
    const group = groups.get(key);
    if (group) group.uses.push(use);
    else groups.set(key, { duration: use.duration, easing: use.easing, uses: [use] });
  }
  return [...groups.values()].sort((left, right) => (right.duration ?? -1) - (left.duration ?? -1));
}

const motion = motionUsage(ownedSources);
const spacingNames = themeScale(globalsSource, "spacing").map((declaration) => declaration.name);

export const foundations = {
  colors: colorTokens(globalsSource),
  themeNames: [...new Set([...blockDeclarations(globalsSource, ":root"), ...blockDeclarations(globalsSource, ".dark")]
    .map((declaration) => declaration.name))],
  type: typeUsage(componentSources),
  radius: { scale: themeScale(globalsSource, "radius"), usage: radiusUsage(componentSources) },
  spacing: { named: themeScale(globalsSource, "spacing"), usage: spacingUsage(componentSources, spacingNames) },
  motion: { timings: timings(motion.uses), press: motion.press, uses: motion.uses },
  scanned: componentSources.length,
  owned: ownedSources.length,
};

export const foundationPages: { id: FoundationId; name: string; kind: string }[] = [
  { id: "foundations/color", name: "Color", kind: `${foundations.colors.length} tokens` },
  { id: "foundations/type", name: "Type", kind: `${foundations.type.sizes.length} sizes` },
  { id: "foundations/radius-spacing", name: "Radius & spacing",
    kind: `${foundations.radius.usage.length + foundations.spacing.usage.length} steps` },
  { id: "foundations/motion", name: "Motion", kind: `${foundations.motion.timings.length} timings` },
];

export function isFoundation(id: string | undefined): id is FoundationId {
  return foundationPages.some((page) => page.id === id);
}
