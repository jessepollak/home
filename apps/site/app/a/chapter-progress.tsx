"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Chapter = { id: string; label: string; part: 1 | 2 };

const READING_LINE = 0.45;

export function ChapterProgress({ chapters }: { chapters: readonly Chapter[] }) {
  const [active, setActive] = useState(-1);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const line = window.innerHeight * READING_LINE;
      let next = -1;
      chapters.forEach((chapter, index) => {
        const section = document.getElementById(chapter.id);
        if (section && section.getBoundingClientRect().top <= line) next = index;
      });
      setActive(next);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [chapters]);

  return (
    <nav aria-label="Chapters" className="mx-auto flex h-11 max-w-5xl items-center gap-4 px-5">
      <p className="grid w-32 shrink-0 text-sm md:w-44">
        <span className={cn("col-start-1 row-start-1 truncate text-muted-foreground transition-opacity duration-base ease-standard", active !== -1 && "opacity-0")}>
          Follow Maya
        </span>
        {chapters.map((chapter, index) => (
          <span
            key={chapter.id}
            aria-hidden="true"
            className={cn(
              "col-start-1 row-start-1 flex min-w-0 gap-2 transition-[opacity,translate] duration-base ease-standard motion-reduce:translate-y-0",
              index === active ? "opacity-100" : "opacity-0",
              index > active && "translate-y-1",
              index < active && "-translate-y-1",
            )}
          >
            <span className="text-muted-foreground tabular-nums">{String(index + 1).padStart(2, "0")}</span>
            <span className="truncate font-medium">{chapter.label}</span>
          </span>
        ))}
      </p>
      <ol className="flex min-w-0 flex-1 list-none gap-1 p-0">
        {chapters.map((chapter, index) => (
          <li key={chapter.id} className={cn("flex min-w-0 flex-1", index > 0 && chapter.part !== chapters[index - 1]?.part && "ms-2 md:ms-4")}>
            <a
              href={`#${chapter.id}`}
              aria-label={`Chapter ${index + 1}: ${chapter.label}`}
              aria-current={index === active ? "step" : undefined}
              className="group flex h-11 flex-1 items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="relative h-1 flex-1 overflow-hidden rounded-full bg-border transition-[scale] duration-fast ease-standard group-hover:scale-y-150 group-active:scale-y-100">
                <span
                  className={cn(
                    "absolute inset-0 origin-left bg-primary transition-[scale,opacity] duration-(--motion-duration-slow) ease-(--motion-ease-emphasized)",
                    index <= active ? "scale-x-100" : "scale-x-0",
                    index < active && "opacity-40",
                  )}
                />
              </span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
