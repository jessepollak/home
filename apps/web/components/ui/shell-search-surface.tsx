"use client";

import { useEffect, useLayoutEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { motion, useIsPresent, usePresence } from "motion/react";
import { useReducedMotion } from "@/components/money-ticker";
import styles from "@/components/primary-navigation.module.css";

const searchMorphTransition = { duration: 0.3, ease: [0.4, 0, 0.2, 1] } as const;
const searchMorphProperties = new Set(["transform", "opacity"]);

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

const searchMorphExitDeadlineMs = 1000;

export function ShellSearchBar({ field, action }: { field: ReactNode; action: ReactNode }) {
  const [present, safeToRemove] = usePresence();
  const barRef = useRef<HTMLDivElement>(null);
  const safeToRemoveRef = useRef(safeToRemove);
  useLayoutEffect(() => { safeToRemoveRef.current = safeToRemove; });
  useEffect(() => {
    if (present) return;
    let active = true;
    const remove = () => {
      if (!active) return;
      active = false;
      window.clearTimeout(deadline);
      safeToRemoveRef.current?.();
    };
    const deadline = window.setTimeout(remove, searchMorphExitDeadlineMs);
    const settle = () => {
      if (!active) return;
      const morphs = (barRef.current?.getAnimations({ subtree: true }) ?? []).filter((animation) => animation instanceof CSSTransition && searchMorphProperties.has(animation.transitionProperty));
      if (morphs.length === 0) { remove(); return; }
      void Promise.all(morphs.map((morph) => morph.finished.catch(() => undefined))).then(settle);
    };
    settle();
    return () => { active = false; window.clearTimeout(deadline); };
  }, [present]);
  return <div ref={barRef} data-asset-search-bar="" data-search-morph={present ? "open" : "closed"}
    className={`${styles.assetSearchBar} fixed flex items-center gap-2`}>
    <div className={`${styles.searchMorphField} relative flex min-w-0 flex-1`}>
      <span aria-hidden="true" className={`${styles.glass} ${styles.searchMorphShadow} pointer-events-none absolute inset-0 rounded-full`} />
      {field}
    </div>
    <div className={`${styles.searchMorphAction} shrink-0`}>{action}</div>
  </div>;
}
