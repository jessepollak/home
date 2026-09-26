export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Rect = Point & Size;
export type Camera = Point & { zoom: number };
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 2;
export function clampZoom(zoom: number): number { return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)); }
export function fitRect(viewport: Size, rect: Rect, padding = 32): Camera {
  const zoom = clampZoom(Math.min(
    (viewport.width - 2 * padding) / Math.max(1, rect.width),
    (viewport.height - 2 * padding) / Math.max(1, rect.height),
  ));
  return {
    x: (viewport.width - rect.width * zoom) / 2 - rect.x * zoom,
    y: (viewport.height - rect.height * zoom) / 2 - rect.y * zoom,
    zoom,
  };
}
export function initialFrameFit(viewport: Size, rect: Rect, fitted: boolean): Camera | undefined {
  if (fitted || !viewport.width || !viewport.height) return undefined;
  return fitRect(viewport, rect, 32);
}
export const FRAME_HEADROOM = 120;
export function showFrameLabel(width: number, zoom: number, headroom = FRAME_HEADROOM): boolean {
  return width * zoom >= 44 && headroom * zoom >= 18;
}
export function zoomAt(camera: Camera, point: Point, factor: number): Camera {
  const zoom = clampZoom(camera.zoom * factor);
  const ratio = zoom / camera.zoom;
  return { zoom, x: point.x - (point.x - camera.x) * ratio, y: point.y - (point.y - camera.y) * ratio };
}
export function pan(camera: Camera, delta: Point): Camera {
  return { ...camera, x: camera.x + delta.x, y: camera.y + delta.y };
}
export function pinch(camera: Camera, from: [Point, Point], to: [Point, Point]): Camera {
  const fromMid = { x: (from[0].x + from[1].x) / 2, y: (from[0].y + from[1].y) / 2 };
  const toMid = { x: (to[0].x + to[1].x) / 2, y: (to[0].y + to[1].y) / 2 };
  const fromDistance = Math.hypot(from[1].x - from[0].x, from[1].y - from[0].y);
  const toDistance = Math.hypot(to[1].x - to[0].x, to[1].y - to[0].y);
  const zoomed = fromDistance === 0 ? camera : zoomAt(camera, fromMid, toDistance / fromDistance);
  return pan(zoomed, { x: toMid.x - fromMid.x, y: toMid.y - fromMid.y });
}
