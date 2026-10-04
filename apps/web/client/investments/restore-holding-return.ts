import type { AssetKey } from "@/shared/balances/types";

export function restoreHoldingReturn(main: HTMLElement, key: AssetKey, settled: () => void): () => void {
  const section = main.querySelector('[aria-labelledby="investments-held-heading"]');
  const document = main.ownerDocument;
  const initialFocus = document.activeElement;
  let disposed = false;
  let focusMoved = false;
  let scrolled = false;
  const onFocus = () => { focusMoved = true; };
  const onScroll = () => { scrolled = true; };
  const onKey = (event: KeyboardEvent) => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) scrolled = true;
  };
  const observer = new MutationObserver(() => {
    if (disposed) return;
    if (!section?.isConnected || !main.contains(section)) { dispose(); return; }
    if (section.getAttribute("aria-busy") === "true") return;
    dispose();
    settled();
    if (initialFocus instanceof HTMLElement && initialFocus !== document.body && initialFocus.isConnected && document.activeElement !== initialFocus) focusMoved = true;
    const row = main.querySelector<HTMLElement>(`[data-holding-key="${CSS.escape(key)}"]`);
    if (!focusMoved) row?.closest("button")?.focus({ preventScroll: true });
    if (!focusMoved && !scrolled) row?.scrollIntoView({ block: "center", behavior: "auto" });
  });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    document.removeEventListener("focusin", onFocus, true);
    for (const type of ["wheel", "touchmove", "pointerdown"]) document.removeEventListener(type, onScroll, true);
    document.removeEventListener("keydown", onKey, true);
  };
  document.addEventListener("focusin", onFocus, true);
  for (const type of ["wheel", "touchmove", "pointerdown"]) document.addEventListener(type, onScroll, { capture: true, passive: true });
  document.addEventListener("keydown", onKey, true);
  observer.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-busy"] });
  return dispose;
}
