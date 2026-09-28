let registeredCleanup: (() => void) | undefined;

export function registerDomTestCleanup(cleanup: () => void) {
  registeredCleanup = cleanup;
}

export function runDomTestCleanup() {
  registeredCleanup?.();
}
