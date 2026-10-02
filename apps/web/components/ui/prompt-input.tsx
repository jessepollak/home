"use client";

import type { ComponentProps } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export function PromptInput({ className, ...props }: ComponentProps<"form">) {
  return <form data-slot="prompt-input" className={cn("flex items-end gap-1.5 rounded-3xl border border-input bg-background p-1.5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30", className)} {...props} />;
}

export function PromptInputTextarea({ className, ...props }: ComponentProps<"textarea">) {
  return <Textarea data-slot="prompt-input-textarea" rows={1} className={cn("max-h-40 min-h-11 resize-none border-0 bg-transparent px-3 py-2.5 focus-visible:ring-0 dark:bg-transparent", className)} {...props} />;
}

export function PromptInputSubmit({ busy, disabled = false, onStop }: { busy: boolean; disabled?: boolean; onStop: () => void }) {
  return busy
    ? <Button type="button" size="icon-lg" press="icon" className="size-11 shrink-0 rounded-full" aria-label="Stop" onClick={onStop}><Square aria-hidden="true" className="size-3.5 fill-current" /></Button>
    : <Button type="submit" size="icon-lg" press="icon" className="size-11 shrink-0 rounded-full" aria-label="Send" disabled={disabled}><ArrowUp aria-hidden="true" /></Button>;
}
