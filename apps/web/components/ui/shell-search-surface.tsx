"use client";

import type { ComponentProps } from "react";
import { motion, useIsPresent } from "motion/react";
import { useReducedMotion } from "@/components/money-ticker";
import styles from "@/components/primary-navigation.module.css";

export function ShellSearchSurface({ className, children, ...props }: ComponentProps<"section">) {
  const present = useIsPresent();
  const reducedMotion = useReducedMotion();
  return <section {...props} role="dialog" aria-modal={present ? true : undefined} aria-label="Search assets" tabIndex={-1}
    inert={!present} aria-hidden={present ? undefined : true}
    className={`fixed inset-0 z-40 isolate flex flex-col outline-none ${present ? "" : "pointer-events-none"} ${className ?? ""}`}>
    <motion.div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-muted" initial={{ opacity: reducedMotion ? 1 : 0 }}
      animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : 0.12, ease: "easeOut" }} />
    {children}
  </section>;
}

export function ShellSearchBar({ children }: { children: React.ReactNode }) {
  const reducedMotion = useReducedMotion();
  return <motion.div data-asset-search-bar="" className={`${styles.assetSearchBar} fixed inset-x-4 flex items-center gap-2 sm:mx-auto sm:max-w-2xl`}
    initial={{ opacity: reducedMotion ? 1 : 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    transition={{ duration: reducedMotion ? 0 : 0.12, ease: "easeOut" }}>{children}</motion.div>;
}
