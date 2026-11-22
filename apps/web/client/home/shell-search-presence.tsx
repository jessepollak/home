"use client";

import type { ReactNode } from "react";
import { AnimatePresence } from "motion/react";

export function ShellSearchPresence({ children }: { children: ReactNode }) {
  return <AnimatePresence>{children}</AnimatePresence>;
}
