export function preserveRowFocus(list: HTMLUListElement) {
  let container = list.parentElement;
  const document = list.ownerDocument;
  const focused = document.activeElement;
  let key = focused instanceof HTMLElement && list.contains(focused)
    ? focused.querySelector<HTMLElement>("[data-holding-key]")?.dataset.holdingKey : null;
  if (!key || !container) return null;
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
    for (const event of ["focusin", "pointerdown", "keydown"]) document.removeEventListener(event, cancel, true);
    observer.disconnect();
    container = null;
    key = null;
  };
  const observer = new MutationObserver((records) => {
    if (!container?.isConnected || records.some((record) => record.type === "attributes")) cancel();
  });
  for (const event of ["focusin", "pointerdown", "keydown"]) document.addEventListener(event, cancel, true);
  for (let ancestor: HTMLElement | null = container; ancestor; ancestor = ancestor.parentElement) {
    observer.observe(ancestor, { childList: true, attributes: true, attributeFilter: ["hidden", "inert", "aria-hidden"] });
  }
  return {
    cancel,
    restore(next: HTMLUListElement) {
      const allowed = !cancelled && !observer.takeRecords().some((record) => record.type === "attributes") && next.parentElement === container && container?.isConnected &&
        !container.closest('[hidden], [inert], [aria-hidden="true"]') && document.activeElement === document.body;
      const row = allowed && key ? next.querySelector<HTMLElement>(`[data-holding-key="${CSS.escape(key)}"]`) : null;
      cancel();
      row?.closest("button")?.focus({ preventScroll: true });
    },
  };
}
