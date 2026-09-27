export type RecentCache<T> = {
  get: (key: string) => T | undefined;
  set: (key: string, value: T) => T;
};

export function createRecentCache<T>(limit: number): RecentCache<T> {
  const entries = new Map<string, T>();
  const touch = (key: string, value: T) => {
    entries.delete(key);
    entries.set(key, value);
    while (entries.size > Math.max(1, limit)) entries.delete(entries.keys().next().value as string);
    return value;
  };
  return {
    get: (key) => {
      const value = entries.get(key);
      return value === undefined ? undefined : touch(key, value);
    },
    set: touch,
  };
}
