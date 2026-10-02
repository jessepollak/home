import "server-only";

export type ScheduledTask = Promise<unknown> | (() => Promise<unknown>);

export function createAfterSchedule(
  retain: (task: Promise<unknown>) => void,
  onUnavailable: () => void,
) {
  return (scheduled: ScheduledTask): void => {
    const task = typeof scheduled === "function" ? scheduled() : scheduled;
    try {
      retain(task);
    } catch { // oxlint-disable-line home/no-silent-catch -- onUnavailable is the caller-injected reporter; every caller passes an emitServerEvent callback
      void task.catch(() => {}); // oxlint-disable-line home/no-silent-catch -- the failed retention is reported by onUnavailable; consume the detached task rejection
      onUnavailable();
    }
  };
}
