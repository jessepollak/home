"use client";

import { useEffect, useLayoutEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { animate, motion, useIsPresent, useMotionValue, usePresence, useTransform, type MotionStyle, type MotionValue } from "motion/react";
import { useReducedMotion } from "@/components/money-ticker";
import styles from "@/components/primary-navigation.module.css";

const searchMorphTransition = { duration: 0.3, ease: [0.4, 0, 0.2, 1] } as const;

export function ShellSearchSurface({ className, children, ...props }: ComponentProps<"section">) {
  const present = useIsPresent();
  const reducedMotion = useReducedMotion();
  return <section {...props} role="dialog" aria-modal={present ? true : undefined} aria-label="Search assets" tabIndex={-1}
    inert={!present} aria-hidden={present ? undefined : true}
    className={`fixed inset-0 z-40 isolate flex flex-col outline-none ${present ? "" : "pointer-events-none"} ${className ?? ""}`}>
    <motion.div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-muted" initial={{ opacity: reducedMotion ? 1 : 0 }}
      animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={reducedMotion ? { duration: 0 } : searchMorphTransition} />
    {children}
  </section>;
}

export function ShellSearchBar({ field, action }: { field: ReactNode; action: ReactNode }) {
  const reducedMotion = useReducedMotion();
  const [present, safeToRemove] = usePresence();
  const safeToRemoveRef = useRef(safeToRemove);
  useLayoutEffect(() => { safeToRemoveRef.current = safeToRemove; });
  const progress = useMotionValue(reducedMotion ? 1 : 0);
  const rest = useTransform(progress, (value) => 1 - value);
  useEffect(() => {
    const target = present ? 1 : 0;
    if (reducedMotion) {
      progress.jump(target);
      if (!present) safeToRemoveRef.current?.();
      return;
    }
    let active = true;
    const controls = animate(progress, target, searchMorphTransition);
    if (!present) void controls.then(() => { if (active) safeToRemoveRef.current?.(); });
    return () => { active = false; controls.stop(); };
  }, [present, reducedMotion, progress]);
  const morphStyle: MotionStyle & Record<"--search-morph-rest", MotionValue<number>> = { "--search-morph-rest": rest };
  return <motion.div data-asset-search-bar="" style={morphStyle}
    className={`${styles.assetSearchBar} fixed inset-x-4 flex items-center gap-2 sm:mx-auto sm:max-w-2xl`}>
    <div className={`${styles.searchMorphField} flex min-w-0 flex-1`}>{field}</div>
    <div className={`${styles.searchMorphAction} shrink-0`}>{action}</div>
  </motion.div>;
}
