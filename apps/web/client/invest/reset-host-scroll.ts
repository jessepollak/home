export function resetHostScroll(from: Element | null) {
  const host = from instanceof Element ? from.closest("[data-app-main-authenticated]") : null;
  if (host instanceof HTMLElement) {
    host.scrollTop = 0;
  }
  window.scrollTo(0, 0);
}
