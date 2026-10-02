import "server-only";

type Entry = { writers: number; latest: number };

export function createWriteOrder() {
  const entries = new Map<string, Entry>();
  let sequence = 0;

  return {
    settle<T>(key: string, request: Promise<T>, write: (value: T) => boolean): Promise<T> {
      const order = ++sequence;
      let entry = entries.get(key);
      if (!entry) {
        entry = { writers: 0, latest: 0 };
        entries.set(key, entry);
      }
      entry.writers += 1;
      return request.then((value) => {
        if (order > entry.latest && write(value)) entry.latest = order;
        return value;
      }).finally(() => {
        entry.writers -= 1;
        if (entry.writers === 0 && entries.get(key) === entry) entries.delete(key);
      });
    },
    get size(): number {
      return entries.size;
    },
  };
}
