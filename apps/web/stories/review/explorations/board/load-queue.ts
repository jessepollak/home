export type QueueFrame = { id: string; x: number; y: number; width: number; height: number };
export type LoadQueue = {
  take(center: { x: number; y: number }): string[];
  complete(id: string): void;
  requeue(id: string): void;
  claim(id: string): void;
  pending(): number;
};
export function createLoadQueue(frames: QueueFrame[], limit = 6): LoadQueue {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Load queue concurrency must be positive");
  const original = new Map(frames.map((frame) => [frame.id, frame]));
  const waiting = new Map(original);
  const active = new Set<string>();
  return {
    take(center) {
      const sorted = [...waiting.values()].sort((a, b) => {
        const distance = (frame: QueueFrame) => Math.hypot(frame.x + frame.width / 2 - center.x, frame.y + frame.height / 2 - center.y);
        return distance(a) - distance(b);
      });
      const batch = sorted.slice(0, Math.max(0, limit - active.size));
      for (const frame of batch) { waiting.delete(frame.id); active.add(frame.id); }
      return batch.map((frame) => frame.id);
    },
    complete(id) { active.delete(id); },
    claim(id) {
      if (waiting.delete(id)) active.add(id);
    },
    requeue(id) {
      if (active.delete(id)) waiting.set(id, original.get(id)!);
    },
    pending() { return waiting.size + active.size; },
  };
}
