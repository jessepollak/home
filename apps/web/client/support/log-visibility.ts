const LOG_END_THRESHOLD_PX = 8;

export function logAtLatest(element: HTMLElement | null): boolean {
  return !element || element.scrollHeight - element.scrollTop - element.clientHeight <= LOG_END_THRESHOLD_PX;
}

function measurable(log: HTMLElement): boolean {
  const rect = log.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0;
}

function intersects(log: HTMLElement, message: Element): boolean {
  const logRect = log.getBoundingClientRect();
  const messageRect = message.getBoundingClientRect();
  return messageRect.top < logRect.bottom && messageRect.bottom > logRect.top;
}

export function newestVisibleMessageId(log: HTMLElement | null, author: (authorType: string) => boolean): string | null {
  if (!log) return null;
  const rendered = [...log.querySelectorAll("[data-message-id]")];
  const visible = measurable(log);
  for (let index = rendered.length - 1; index >= 0; index--) {
    const message = rendered[index];
    if (!author(message.getAttribute("data-message-author") ?? "")) continue;
    if (!visible || intersects(log, message)) return message.getAttribute("data-message-id");
  }
  return null;
}
