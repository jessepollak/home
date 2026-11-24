"use client";

import { useEffect, useState } from "react";

const READING_LINE = "-40% 0px -55% 0px";

export function useActiveSection(ids: readonly string[]) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const elements = ids.flatMap((id) => {
      const element = document.getElementById(id);
      return element ? [element] : [];
    });
    if (elements.length === 0) return;
    const crossing = new Set<string>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) crossing.add(entry.target.id);
        else crossing.delete(entry.target.id);
      }
      setActive(ids.find((id) => crossing.has(id)) ?? null);
    }, { rootMargin: READING_LINE, threshold: 0 });
    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, [ids]);

  return active;
}
