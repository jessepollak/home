export type ScheduledTask = Promise<unknown> | (() => Promise<unknown>);

/** Starts a scheduled thunk immediately, then asks the runtime to retain its promise. */
export function createAfterSchedule(
  retain: (task: Promise<unknown>) => void,
  onUnavailable: () => void,
) {
  return (scheduled: ScheduledTask): void => {
    const task = typeof scheduled === "function" ? scheduled() : scheduled;
    try {
      retain(task);
    } catch {
      void task.catch(() => {});
      onUnavailable();
    }
  };
}
