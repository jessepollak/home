"use client";

import dynamic from "next/dynamic";
import { AGENTATION_ENDPOINT, shouldRenderAgentation } from "./agentation-gate";

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
