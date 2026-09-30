import type { ReactElement } from "react";
import type { Root } from "react-dom/client";

export type HydratedServerRender = {
  container: HTMLDivElement;
  hydrationErrors: unknown[];
  root: Root;
  serverMarkup: string;
  unmount: () => Promise<void>;
};

export async function hydrateServerRender(
  element: ReactElement,
  options: { beforeHydrate?: () => void; clientElement?: ReactElement } = {},
): Promise<HydratedServerRender> {
  const { act } = await import("@testing-library/react");
  const { hydrateRoot } = await import("react-dom/client");
  const { renderToString } = await import("react-dom/server");
  const serverMarkup = renderToString(element);
  const container = document.createElement("div");
  container.innerHTML = serverMarkup;
  document.body.append(container);
  const hydrationErrors: unknown[] = [];
  let root!: Root;
  let hydrated = false;
  let teardownPromise: Promise<void> | null = null;
  const teardown = () => {
    teardownPromise ??= (async () => {
      try {
        if (hydrated) await act(async () => root.unmount());
      } finally {
        container.remove();
      }
    })();
    return teardownPromise;
  };

  try {
    options.beforeHydrate?.();
    await act(async () => {
      root = hydrateRoot(container, options.clientElement ?? element, {
        onRecoverableError: (error) => hydrationErrors.push(error),
      });
      hydrated = true;
    });
  } catch (error) {
    const teardownOutcome = await teardown().then(
      () => ({ failed: false as const }),
      (failure: unknown) => ({ failed: true as const, failure }),
    );
    if (!teardownOutcome.failed) {
      throw error;
    }
    throw new AggregateError([error, teardownOutcome.failure], error instanceof Error ? error.message : String(error));
  }

  return {
    container,
    hydrationErrors,
    root,
    serverMarkup,
    unmount: teardown,
  };
}
