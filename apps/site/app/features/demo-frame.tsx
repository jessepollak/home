"use client";

import { RotateCcw } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { useStoryboard } from "./use-storyboard";

export function DemoFrame({ attach, step, done, run, replay, label, children }: ReturnType<typeof useStoryboard> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex w-full max-w-sm flex-col gap-2 justify-self-center md:justify-self-end">
      <div ref={attach} inert aria-hidden="true" className="select-none" data-demo-step={step} data-demo-done={done ? "" : undefined}>
        <Fragment key={run}>{children}</Fragment>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-end text-foreground/70 motion-reduce:hidden"
        aria-label={`Replay the ${label} example`}
        onClick={replay}
      >
        <RotateCcw data-icon="inline-start" aria-hidden="true" />
        Replay
      </Button>
    </div>
  );
}
