import {
  readClientScrollTop,
  replaceClientScrollTop,
  subscribeBeforeClientUrlCommit,
} from "@/config/shell-location";

const scrollQuietMs = 150;

export function subscribeShellScrollPersistence(scroller: HTMLElement): () => void {
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  const cancelPending = () => {
    if (pendingTimer === null) return;
    clearTimeout(pendingTimer);
    pendingTimer = null;
  };
  const persist = () => {
    cancelPending();
    const scrollTop = Math.max(0, scroller.scrollTop);
    if (readClientScrollTop() !== scrollTop) replaceClientScrollTop(scrollTop);
  };
  const schedulePersist = () => {
    cancelPending();
    pendingTimer = setTimeout(persist, scrollQuietMs);
  };
  const persistIfHidden = () => {
    if (document.visibilityState === "hidden") persist();
  };
  const unsubscribe = subscribeBeforeClientUrlCommit(persist);
  const supportsScrollEnd = "onscrollend" in scroller;
  scroller.addEventListener(supportsScrollEnd ? "scrollend" : "scroll", supportsScrollEnd ? persist : schedulePersist, { passive: true });
  window.addEventListener("pagehide", persist);
  document.addEventListener("visibilitychange", persistIfHidden);
  window.addEventListener("popstate", cancelPending);
  return () => {
    cancelPending();
    persist();
    scroller.removeEventListener(supportsScrollEnd ? "scrollend" : "scroll", supportsScrollEnd ? persist : schedulePersist);
    window.removeEventListener("pagehide", persist);
    document.removeEventListener("visibilitychange", persistIfHidden);
    window.removeEventListener("popstate", cancelPending);
    unsubscribe();
  };
}
