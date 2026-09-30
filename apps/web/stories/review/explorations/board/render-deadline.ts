export type DeadlineClock = {
  schedule: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel: (timer: ReturnType<typeof setTimeout>) => void;
};

export function startRenderDeadline(fail: (error: string) => void, clock: DeadlineClock = {
  schedule: (callback, delay) => setTimeout(callback, delay),
  cancel: (timer) => clearTimeout(timer),
}): () => void {
  const timer = clock.schedule(() => fail("Story did not finish rendering in 20 s"), 20_000);
  return () => clock.cancel(timer);
}
