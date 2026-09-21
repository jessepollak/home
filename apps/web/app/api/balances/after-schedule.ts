export type ScheduledTask = Promise<unknown> | (() => Promise<unknown>);

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
