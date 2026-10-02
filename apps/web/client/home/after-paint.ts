"use client";

export function scheduleAfterPaint(run: () => void): () => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let frame: number | null = window.requestAnimationFrame(() => {
    frame = null;
    timeout = setTimeout(() => {
      timeout = null;
      run();
    }, 0);
  });
  return () => {
    if (frame !== null) window.cancelAnimationFrame(frame);
    if (timeout !== null) clearTimeout(timeout);
    frame = null;
    timeout = null;
  };
}
