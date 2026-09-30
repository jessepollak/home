import {
  readClientScrollTop,
  replaceClientScrollTop,
  subscribeBeforeClientUrlCommit,
} from "@/config/shell-location";

const scrollThrottleMs = 250;

export function subscribeShellScrollPersistence(scroller: HTMLElement): () => void {
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  const cancelPending = () => {
    dirty = false;
    if (pendingTimer !== null) clearTimeout(pendingTimer);
    pendingTimer = null;
  };
  const writeScrollTop = () => {
    const scrollTop = Math.max(0, scroller.scrollTop);
    if (readClientScrollTop() !== scrollTop) replaceClientScrollTop(scrollTop);
  };
  const persist = () => {
    cancelPending();
    writeScrollTop();
  };
  const persistTrailing = () => {
    pendingTimer = null;
    if (!dirty) return;
    dirty = false;
    writeScrollTop();
    pendingTimer = setTimeout(persistTrailing, scrollThrottleMs);
  };
  const schedulePersist = () => {
    if (pendingTimer !== null) {
      dirty = true;
      return;
    }
    writeScrollTop();
    pendingTimer = setTimeout(persistTrailing, scrollThrottleMs);
  };
  const persistIfHidden = () => {
    if (document.visibilityState === "hidden") persist();
  };
  const unsubscribe = subscribeBeforeClientUrlCommit(persist);
  const supportsScrollEnd = "onscrollend" in scroller;
  scroller.addEventListener("scroll", schedulePersist, { passive: true });
  if (supportsScrollEnd) scroller.addEventListener("scrollend", persist, { passive: true });
  window.addEventListener("pagehide", persist);
  document.addEventListener("visibilitychange", persistIfHidden);
  window.addEventListener("popstate", cancelPending);
  return () => {
    persist();
    scroller.removeEventListener("scroll", schedulePersist);
    if (supportsScrollEnd) scroller.removeEventListener("scrollend", persist);
    window.removeEventListener("pagehide", persist);
    document.removeEventListener("visibilitychange", persistIfHidden);
    window.removeEventListener("popstate", cancelPending);
    unsubscribe();
  };
}
