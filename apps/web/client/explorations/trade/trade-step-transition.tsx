import type { ReactNode } from "react";

export function TradeStepTransition({ children, stepKey, direction, reducedMotion = false }: { stepKey: string; direction: "forward" | "back"; reducedMotion?: boolean; children: ReactNode }) {
  const spatial = !reducedMotion;
  return <div key={stepKey} className={spatial
    ? `transition-[opacity,translate] duration-180 ease-[cubic-bezier(0.22,1,0.36,1)] starting:opacity-0 motion-reduce:translate-x-0 motion-reduce:starting:translate-x-0 motion-reduce:duration-120 ${direction === "forward" ? "starting:translate-x-3 rtl:starting:-translate-x-3" : "starting:-translate-x-3 rtl:starting:translate-x-3"}`
    : "transition-opacity duration-120 ease-[cubic-bezier(0.22,1,0.36,1)] starting:opacity-0"}>{children}</div>;
}
