export function requireValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Required fixture value is missing");
  return value;
}

export function requireInstance<T>(value: unknown, constructor: new (...args: never[]) => T): T {
  if (!(value instanceof constructor)) throw new Error(`Expected ${constructor.name} fixture`);
  return value;
}

export function isolateFrameDocuments() {
  const happyDom: unknown = Reflect.get(window, "happyDOM");
  if (!happyDom || typeof happyDom !== "object" || !("settings" in happyDom)) throw new Error("Missing happy-dom settings");
  const settings = happyDom.settings;
  if (!settings || typeof settings !== "object" || !("disableIframePageLoading" in settings) ||
    typeof settings.disableIframePageLoading !== "boolean") throw new Error("Missing iframe loading setting");
  const previous = settings.disableIframePageLoading;
  const setAttribute = HTMLIFrameElement.prototype.setAttribute;
  settings.disableIframePageLoading = true;
  HTMLIFrameElement.prototype.setAttribute = function (name, value) {
    if (name === "src") setAttribute.call(this, "srcdoc", "<html><body></body></html>");
    setAttribute.call(this, name, value);
  };
  return () => {
    settings.disableIframePageLoading = previous;
    HTMLIFrameElement.prototype.setAttribute = setAttribute;
  };
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
