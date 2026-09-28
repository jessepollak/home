type VisualViewportGeometry = { height: number; offsetTop: number; scale: number };

function visualViewportShrunk(innerHeight: number, viewport: VisualViewportGeometry): boolean {
  return viewport.scale === 1 && innerHeight - viewport.height > 60;
}

export function visualViewportKeyboardInset(innerHeight: number, viewport: VisualViewportGeometry): number {
  return visualViewportShrunk(innerHeight, viewport)
    ? Math.max(0, Math.ceil(innerHeight - Math.min(innerHeight, Math.max(0, viewport.offsetTop) + viewport.height)))
    : 0;
}

export function visualViewportKeyboardFrame(
  innerHeight: number,
  viewport: VisualViewportGeometry,
): { top: number; inset: number } {
  if (!visualViewportShrunk(innerHeight, viewport)) return { top: 0, inset: 0 };
  const inset = visualViewportKeyboardInset(innerHeight, viewport);
  return { inset, top: Math.min(innerHeight - inset, Math.max(0, Math.floor(viewport.offsetTop))) };
}
