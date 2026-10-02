import type { KeyboardEvent } from "react";

export function shouldSubmitSupportComposer(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches;
}
