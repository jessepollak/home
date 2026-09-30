import "@/client/account/dom-test-harness";

import { describe, expect, test } from "bun:test";
import { hydrateServerRender } from "@/tests/helpers/hydration";

const { useEffect } = await import("react");

function errorMessages(error: unknown): string[] {
  if (error instanceof AggregateError) return error.errors.flatMap(errorMessages);
  return [error instanceof Error ? error.message : String(error)];
}

async function hydrateWithFailingTeardown(teardownFailure: unknown) {
  const createElement = document.createElement;
  document.createElement = ((tagName: string, options?: ElementCreationOptions) => {
    const element = createElement.call(document, tagName, options);
    Reflect.deleteProperty(document, "createElement");
    const detach = element.remove.bind(element);
    element.remove = () => {
      detach();
      throw teardownFailure;
    };
    return element;
  }) as typeof document.createElement;

  try {
    return await hydrateServerRender(<BrokenEffect />).then(
      () => null,
      (error: unknown) => error,
    );
  } finally {
    Reflect.deleteProperty(document, "createElement");
  }
}

function BrokenEffect() {
  useEffect(() => {
    throw new Error("effect failed");
  }, []);
  return <output>marker</output>;
}

let mountedProbes = 0;
function MountProbe() {
  useEffect(() => { mountedProbes += 1; }, []);
  return <output>marker</output>;
}

describe("hydrateServerRender", () => {
  test("unmounts once and detaches its container when teardown runs twice", async () => {
    const before = document.body.childElementCount;
    const fixture = await hydrateServerRender(<output>marker</output>);

    await fixture.unmount();
    await fixture.unmount();

    expect(document.body.childElementCount).toBe(before);
  });

  test("keeps a later hydration working when teardown runs concurrently", async () => {
    const before = document.body.childElementCount;
    const first = await hydrateServerRender(<output>marker</output>);

    await Promise.all([first.unmount(), first.unmount()]);
    const second = await hydrateServerRender(<MountProbe />);

    expect(mountedProbes).toBe(1);
    await second.unmount();
    expect(document.body.childElementCount).toBe(before);
  });

  test("detaches its container when the setup callback throws", async () => {
    const before = document.body.childElementCount;

    await expect(hydrateServerRender(<output>marker</output>, {
      beforeHydrate: () => { throw new Error("setup failed"); },
    })).rejects.toThrow("setup failed");

    expect(document.body.childElementCount).toBe(before);
  });

  test("detaches its container when a hydration effect throws", async () => {
    const before = document.body.childElementCount;

    await expect(hydrateServerRender(<BrokenEffect />)).rejects.toThrow("effect failed");

    expect(document.body.childElementCount).toBe(before);
  });

  test("keeps the hydration failure when teardown also fails", async () => {
    const before = document.body.childElementCount;

    const failure = await hydrateWithFailingTeardown(new Error("teardown failed"));

    expect(failure).toBeInstanceOf(AggregateError);
    expect(errorMessages(failure)).toEqual(["effect failed", "teardown failed"]);
    expect(document.body.childElementCount).toBe(before);
  });

  test("keeps the hydration failure when teardown rejects without a value", async () => {
    const before = document.body.childElementCount;

    const failure = await hydrateWithFailingTeardown(undefined);

    expect(failure).toBeInstanceOf(AggregateError);
    expect(errorMessages(failure)).toEqual(["effect failed", "undefined"]);
    expect(document.body.childElementCount).toBe(before);
  });
});
