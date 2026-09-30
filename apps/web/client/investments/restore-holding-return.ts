import type { AssetKey } from "@/shared/balances/types";

export function restoreHoldingReturn(main: HTMLElement, key: AssetKey, restored: (row: HTMLElement | null) => void) {
  const observer = new MutationObserver(() => {
    if (main.querySelector('[aria-labelledby="investments-held-heading"][aria-busy="true"]')) return;
    observer.disconnect();
    const row = main.querySelector<HTMLElement>(`[data-holding-key="${CSS.escape(key)}"]`);
    restored(row);
  });
  observer.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-busy"] });
  return () => observer.disconnect();
}
