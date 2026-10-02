export function requireValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Required fixture value is missing");
  return value;
}

export function requireInstance<T>(value: unknown, constructor: new (...args: never[]) => T): T {
  if (!(value instanceof constructor)) throw new Error(`Expected ${constructor.name} fixture`);
  return value;
}

export function inactiveTimer(): ReturnType<typeof setTimeout> {
  const timer = setTimeout(() => {}, 0);
  clearTimeout(timer);
  return timer;
}

export function documentFixture(overrides: Record<string, unknown>): Document {
  const owner = document.implementation.createHTMLDocument();
  for (const [key, value] of Object.entries(overrides)) {
    Object.defineProperty(owner, key, { configurable: true, value });
  }
  return owner;
}
