"use client";

import { startTransition, useOptimistic, type ComponentProps } from "react";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { useShellSearch } from "./shell-search";

export function ShellNavigation(props: ComponentProps<typeof PrimaryNavigation>) {
  const [activeNavigation, selectNavigation] = useOptimistic(props.activeNavigation);
  const search = useShellSearch();
  return <PrimaryNavigation {...props} searchOpen={search.open} onOpenSearch={search.openSearch} activeNavigation={activeNavigation} onNavigate={(panel) => {
    startTransition(() => {
      selectNavigation(panel);
      props.onNavigate(panel);
    });
  }} />;
}
