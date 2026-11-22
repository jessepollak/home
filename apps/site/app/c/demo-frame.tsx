"use client";

import { RotateCcw } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { useStoryboard } from "./use-storyboard";

export function DemoFrame({ attach, step, done, run, playing, motion, replay, staged, label, children }: ReturnType<typeof useStoryboard> & {
  label: string;
  children: ReactNode;
}) {
  const stage = (
    <div ref={attach} inert aria-hidden="true" className="select-none" data-demo="" data-demo-step={step} data-demo-done={done ? "" : undefined} data-demo-playing={playing ? "" : undefined}>
      <Fragment key={run}>{children}</Fragment>
    </div>
  );
  if (staged) return stage;
  return (
    <div className="flex w-full max-w-sm flex-col gap-2 justify-self-center">
      {stage}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn("self-end text-foreground/70 motion-reduce:hidden", !motion && "invisible")}
        disabled={!motion}
        aria-label={`Replay the ${label} example`}
        onClick={replay}
      >
        <RotateCcw data-icon="inline-start" aria-hidden="true" />
        Replay
      </Button>
    </div>
  );
}
