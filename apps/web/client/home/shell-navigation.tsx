"use client";

import { startTransition, useOptimistic, type ComponentProps } from "react";
import { PrimaryNavigation } from "@/components/primary-navigation";

export function ShellNavigation(props: ComponentProps<typeof PrimaryNavigation>) {
  const [activeNavigation, selectNavigation] = useOptimistic(props.activeNavigation);
  return <PrimaryNavigation {...props} activeNavigation={activeNavigation} onNavigate={(panel) => {
    startTransition(() => {
      selectNavigation(panel);
      props.onNavigate(panel);
    });
  }} />;
}
