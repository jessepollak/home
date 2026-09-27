export function visualViewportKeyboardInset(
  innerHeight: number,
  viewport: { height: number; offsetTop: number; scale: number },
): number {
  return viewport.scale === 1 && innerHeight - viewport.height > 60
    ? Math.max(0, Math.ceil(innerHeight - Math.min(innerHeight, Math.max(0, viewport.offsetTop) + viewport.height)))
    : 0;
}
