"use client";

import dynamic from "next/dynamic";
import { AGENTATION_ENDPOINT, shouldRenderAgentation } from "./agentation-gate";

// Loaded lazily in the browser only: `ssr: false` keeps the toolbar out of the
// server render, and the development gate below keeps the chunk from ever being
// fetched in a production build.
const Agentation = dynamic(
  () => import("agentation").then((mod) => ({ default: mod.Agentation })),
  { ssr: false },
);

export function AgentationOverlay({ disabled = false }: { disabled?: boolean }) {
  if (disabled || !shouldRenderAgentation(process.env.NODE_ENV)) {
    return null;
  }
  return <Agentation endpoint={AGENTATION_ENDPOINT} />;
}
