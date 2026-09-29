import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ACCESS_CREDENTIAL_FIELD, ACCESS_RESPONSE_MODE_HEADER } from "@/shared/access/contract";
import { AccessForm } from "./access-form";

const { cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const nativeFetch = globalThis.fetch;
let restoreAssign: (() => void) | undefined;

type Call = { url: string; init: RequestInit };

function recordFetch(result: () => Promise<Response>) {
  const calls: Call[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return await result();
    },
    { preconnect: nativeFetch.preconnect },
  );
  return calls;
}

function pendingResponse() {
  let release: ((response: Response) => void) | undefined;
  let requested = false;
  const promise = new Promise<Response>((resolve) => { release = resolve; });
  return {
    request: () => {
      requested = true;
      return promise;
    },
    resolve: (response: Response) => {
      if (!requested) throw new Error("No response was requested");
      if (!release) throw new Error("Response was already resolved");
      release(response);
      release = undefined;
    },
  };
}

function interceptAssign() {
  const assign = spyOn(window.location, "assign").mockImplementation(() => {});
  restoreAssign = () => assign.mockRestore();
  return assign;
}

function setup() {
  const view = render(<AccessForm next="/borrow?asset=usdc" />);
  const scope = within(view.container);
  const input = scope.getByLabelText("Access password");
  if (!(input instanceof HTMLInputElement) || input.type !== "password") {
    throw new Error("Access password field is not a password input");
  }
  fireEvent.input(input, { target: { value: "typed-credential" } });
  const form = view.container.querySelector("form");
  if (!form) throw new Error("Access form not rendered");
  return { view, scope, input, submit: () => fireEvent.submit(form) };
}

afterEach(() => {
  restoreAssign?.();
  restoreAssign = undefined;
  cleanup();
  globalThis.fetch = nativeFetch;
});

const malformedResponses = [
  ["non-JSON body", () => new Response("not-json", { status: 200 })],
  ["array", () => Response.json([], { status: 200 })],
  ["wrong version", () => Response.json({ version: 2, destination: "/home" }, { status: 200 })],
  ["missing destination", () => Response.json({ version: 1 }, { status: 200 })],
  ["protocol-relative destination", () => Response.json({ version: 1, destination: "//evil.example" }, { status: 200 })],
  ["external destination", () => Response.json({ version: 1, destination: "https://evil.example/x" }, { status: 200 })],
  ["access endpoint destination", () => Response.json({ version: 1, destination: "/api/access" }, { status: 200 })],
  ["access page destination", () => Response.json({ version: 1, destination: "/access" }, { status: 200 })],
  ["non-string destination", () => Response.json({ version: 1, destination: 7 }, { status: 200 })],
] satisfies Array<readonly [string, () => Response]>;

describe("access form", () => {
  test("server-renders a submittable native POST form before hydration", () => {
    const html = renderToStaticMarkup(<AccessForm next="/borrow?asset=usdc" />);

    expect(html).toContain('action="/api/access"');
    expect(html).toContain('method="post"');
    expect(html).toContain('name="next" value="/borrow?asset=usdc"');
    expect(html).toContain('type="submit"');
    expect(html).not.toContain(' disabled=""');
    expect(html).not.toContain("data-hydrated");
  });
});

describe("access form JSON boundary", () => {
  test("posts the credential and next, then navigates on a valid success", async () => {
    const calls = recordFetch(async () => Response.json({ version: 1, destination: "/borrow?asset=usdc" }, { status: 200 }));
    const assign = interceptAssign();
    const { view, submit } = setup();
    submit();

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/access");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toEqual({
      "Content-Type": "application/x-www-form-urlencoded",
      [ACCESS_RESPONSE_MODE_HEADER]: "json",
    });
    expect(calls[0].init.credentials).toBe("same-origin");
    expect(calls[0].init.cache).toBe("no-store");
    expect(calls[0].init.redirect).toBe("error");
    const body = new URLSearchParams(String(calls[0].init.body));
    expect([...body.keys()].sort()).toEqual([ACCESS_CREDENTIAL_FIELD, "next"].sort());
    expect(body.get("next")).toBe("/borrow?asset=usdc");
    expect(body.get(ACCESS_CREDENTIAL_FIELD)).toBe("typed-credential");
    expect(assign).toHaveBeenCalledWith("/borrow?asset=usdc");
    expect(view.queryByRole("alert")).toBeNull();
  });

  test("announces a denied credential and marks the password invalid", async () => {
    recordFetch(async () => Response.json({ version: 1, error: { code: "INVALID_ACCESS" } }, { status: 401 }));
    const assign = interceptAssign();
    const { view, input, submit } = setup();
    submit();

    expect((await view.findByRole("alert")).textContent).toBe("Access denied. Try again.");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(assign).not.toHaveBeenCalled();
  });

  test("announces an unavailable deployment without navigating", async () => {
    recordFetch(async () => Response.json({ version: 1, error: { code: "ACCESS_UNAVAILABLE" } }, { status: 503 }));
    const assign = interceptAssign();
    const { view, submit } = setup();
    submit();

    expect((await view.findByRole("alert")).textContent).toBe("Access is temporarily unavailable.");
    expect(assign).not.toHaveBeenCalled();
  });

  test("does not navigate on a denied response shaped like a success", async () => {
    recordFetch(async () => Response.json({ version: 1, destination: "/home" }, { status: 401 }));
    const assign = interceptAssign();
    const { view, submit } = setup();
    submit();

    expect((await view.findByRole("alert")).textContent).toBe("Access denied. Try again.");
    expect(assign).not.toHaveBeenCalled();
  });

  test.each(malformedResponses)("denies malformed 200 payload: %s", async (_name, response) => {
    recordFetch(async () => response());
    const assign = interceptAssign();
    const { view, submit } = setup();
    submit();

    expect((await view.findByRole("alert")).textContent).toBe("Access denied. Try again.");
    expect(assign).not.toHaveBeenCalled();
  });

  test("recovers the Continue button after a network failure", async () => {
    const assign = interceptAssign();
    recordFetch(async () => { throw new TypeError("Failed to fetch"); });
    const { view, scope, submit } = setup();
    submit();

    expect((await view.findByRole("alert")).textContent).toBe("Access is temporarily unavailable.");
    expect(assign).not.toHaveBeenCalled();
    const button = scope.getByRole<HTMLButtonElement>("button", { name: "Continue" });
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Continue");
  });

  test("disables the button while pending and restores it after success", async () => {
    const deferred = pendingResponse();
    recordFetch(deferred.request);
    const assign = interceptAssign();
    const { scope, submit } = setup();
    submit();

    const button = scope.getByRole<HTMLButtonElement>("button", { name: "Checking…" });
    expect(button.disabled).toBe(true);
    deferred.resolve(Response.json({ version: 1, destination: "/borrow?asset=usdc" }));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(button.disabled).toBe(false));
    expect(button.textContent).toBe("Continue");
  });

  test("clears the previous alert when a new attempt begins", async () => {
    const deferred = pendingResponse();
    let attempt = 0;
    recordFetch(() => {
      attempt += 1;
      return attempt === 1
        ? Promise.resolve(Response.json({ version: 1, error: { code: "INVALID_ACCESS" } }, { status: 401 }))
        : deferred.request();
    });
    const assign = interceptAssign();
    const { view, scope, submit } = setup();
    submit();
    expect((await view.findByRole("alert")).textContent).toBe("Access denied. Try again.");

    submit();
    expect(scope.getByRole<HTMLButtonElement>("button", { name: "Checking…" }).disabled).toBe(true);
    expect(view.queryByRole("alert")).toBeNull();
    deferred.resolve(Response.json({ version: 1, destination: "/borrow?asset=usdc" }));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(assign).toHaveBeenCalledWith("/borrow?asset=usdc");
  });
});
