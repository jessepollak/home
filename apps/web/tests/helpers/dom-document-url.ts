export const testDocumentUrl = "http://localhost:3111/";

function isDocumentUrlSetter(value: unknown): value is { setURL(url: string): void } {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "setURL") === "function";
}

export function restoreTestDocumentUrl(): void {
  if (typeof window === "undefined" || window.location.href === testDocumentUrl) return;
  const registered: unknown = Object.getOwnPropertyDescriptor(globalThis, "happyDOM")?.value;
  if (isDocumentUrlSetter(registered)) registered.setURL(testDocumentUrl);
}
