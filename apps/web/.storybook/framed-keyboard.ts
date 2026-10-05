function isFrameElement(element: Element | null, frameWindow: Window): element is HTMLElement {
  return "HTMLElement" in frameWindow && typeof frameWindow.HTMLElement === "function" && element instanceof frameWindow.HTMLElement;
}

function sameOriginFrames(): HTMLElement[] | null {
  const frames: HTMLElement[] = [];
  let current: Window = window;
  try {
    while (current !== current.top) {
      const element = current.frameElement;
      if (!isFrameElement(element, current.parent)) return null;
      frames.unshift(element);
      current = current.parent;
    }
  } catch {
    return null;
  }
  return frames;
}

let disposeBridge: (() => void) | undefined;

export function bridgeFramedKeyboard(): (() => void) | undefined {
  if (disposeBridge) return disposeBridge;
  const frames = sameOriginFrames();
  if (!frames?.length) return;
  let top: Window | null;
  let topViewport: VisualViewport | null | undefined;
  try {
    top = window.top;
    topViewport = top?.visualViewport;
  } catch {
    return;
  }
  const viewport = window.visualViewport;
  const nativeHeight = viewport && Object.getOwnPropertyDescriptor(Object.getPrototypeOf(viewport), "height")?.get;
  if (!viewport || !top || !topViewport || !nativeHeight) return;
  const originalHeight = Object.getOwnPropertyDescriptor(viewport, "height");

  const keyboardEdge = () => {
    let edge = topViewport.offsetTop + topViewport.height;
    for (const frame of frames) {
      const rect = frame.getBoundingClientRect();
      const scale = frame.offsetHeight > 0 ? rect.height / frame.offsetHeight : 1;
      edge = (edge - rect.top) / scale - frame.clientTop;
    }
    return edge;
  };

  Object.defineProperty(viewport, "height", {
    configurable: true,
    get() {
      const height: number = nativeHeight.call(viewport);
      return topViewport.scale > 1.01 || top.innerHeight - (topViewport.offsetTop + topViewport.height) <= 60
        ? height
        : Math.max(0, Math.min(height, keyboardEdge()));
    },
  });

  const forward = () => viewport.dispatchEvent(new Event("resize"));
  const parents = frames.map((frame) => frame.ownerDocument.defaultView).filter((parent) => parent !== null);
  topViewport.addEventListener("resize", forward);
  topViewport.addEventListener("scroll", forward);
  for (const parent of parents) parent.addEventListener("scroll", forward, { capture: true, passive: true });
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    topViewport.removeEventListener("resize", forward);
    topViewport.removeEventListener("scroll", forward);
    for (const parent of parents) parent.removeEventListener("scroll", forward, { capture: true });
    window.removeEventListener("pagehide", onPageHide);
    if (originalHeight) Object.defineProperty(viewport, "height", originalHeight);
    else Reflect.deleteProperty(viewport, "height");
    disposeBridge = undefined;
  };
  const onPageHide = (event: PageTransitionEvent) => {
    if (!event.persisted) dispose();
  };
  window.addEventListener("pagehide", onPageHide);
  disposeBridge = dispose;
  return dispose;
}
