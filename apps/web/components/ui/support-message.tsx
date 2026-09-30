"use client";

import { Headset, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SupportAuthorType } from "@/shared/support/contract";

export function SupportMessageBubble({ author, side, speaker, children, delivery, onRetry, continued = false }: {
  author: SupportAuthorType;
  side: "customer" | "operator";
  speaker?: string;
  children: React.ReactNode;
  delivery?: "sending" | "failed" | "sent";
  onRetry?: () => void;
  continued?: boolean;
}) {
  const mine = author === side;
  const spoken = speaker ?? (author === side ? "You" : author === "customer" ? "Customer" : author === "operator" ? "Support" : "Assistant");
  if (side === "customer" && !mine) {
    const Icon = author === "assistant" ? Sparkles : Headset;
    return <div className="flex min-w-0 flex-col items-start gap-1">
      {continued ? <span className="sr-only">{spoken}</span> : <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Icon aria-hidden="true" className="size-3.5" />{spoken}</span>}
      <div className="max-w-full min-w-0 whitespace-pre-wrap wrap-anywhere text-sm leading-relaxed text-foreground">{children}</div>
    </div>;
  }
  return <div className={`flex min-w-0 flex-col gap-1 ${mine ? "items-end" : "items-start"}`}>
    <div className={`max-w-[85%] min-w-0 whitespace-pre-wrap wrap-anywhere px-3 py-2 text-sm ${side === "customer" ? "rounded-2xl" : "rounded-xl"} ${mine ? "bg-primary text-primary-foreground" : author === "assistant" ? "border border-border bg-muted text-foreground" : "bg-muted text-foreground"}`}>
      {author === "assistant" ? <span className="mb-1 block text-xs font-semibold">Assistant</span> : <span className="sr-only">{spoken}</span>}
      {children}
    </div>
    {delivery ? <span className="text-xs text-muted-foreground" role="status">{delivery === "sending" ? "Sending…" : delivery === "failed" ? "Not sent" : "Sent"}</span> : null}
    {delivery === "failed" && onRetry ? <Button variant="link" size="touch" onClick={onRetry}>Retry</Button> : null}
  </div>;
}
