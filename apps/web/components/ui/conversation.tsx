"use client";

import { ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ConversationScrollButton({ onClick }: { onClick: () => void }) {
  return <Button type="button" variant="outline" size="icon-lg" press="icon" aria-label="Scroll to latest message" className="absolute bottom-3 start-1/2 size-11 -translate-x-1/2 rounded-full shadow-sm rtl:translate-x-1/2" onClick={onClick}><ArrowDown aria-hidden="true" /></Button>;
}
