import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import type { ReviewBuild } from "@/stories/review/explorations/board/review-build";
import { deferred } from "@/tests/helpers/async";

const { act, cleanup, render } = await import("@testing-library/react");
const { BuildChip } = await import("@/stories/review/explorations/board/build-chip");

const build: ReviewBuild = {
  revision: "4f2a9c1e8b7d6a5f4e3d2c1b0a9f8e7d6c5b4a39",
  deployment: "home-preview",
  branch: "agent/1210",
  repo: { owner: "jessepollak", name: "home" },
  pr: null,
  changedFiles: null,
};

afterEach(() => { cleanup(); sessionStorage.clear(); });

describe("BuildChip commit link", () => {
  test("keeps its own href, target, rel and full-revision title after the forwarded chip props", () => {
    const view = render(<BuildChip build={build} />);
    const link = view.getByRole("link");
    expect(link.getAttribute("href")).toBe(`https://github.com/jessepollak/home/commit/${build.revision}`);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer");
    expect(link.getAttribute("title")).toBe(`${build.revision} · agent/1210`);
    expect(link.textContent).toBe("4f2a9c1 · agent/1210");
  });

  test("keeps the full revision as the link title when there is no branch", () => {
    const view = render(<BuildChip build={{ ...build, branch: "" }} />);
    const link = view.getByRole("link");
    expect(link.getAttribute("title")).toBe(build.revision);
    expect(link.textContent).toBe("4f2a9c1");
  });

  test("falls back to a titled chip without a link when the repository is unknown", () => {
    const view = render(<BuildChip build={{ ...build, repo: null }} />);
    const chip = view.getByTitle(`${build.revision} · agent/1210`);
    expect(chip.getAttribute("href")).toBeNull();
    expect(view.queryByRole("link")).toBeNull();
  });
});

describe("BuildChip pull request link", () => {
  test("renders a cached status and titles both chips", async () => {
    sessionStorage.setItem("review-pr:jessepollak/home#1283", JSON.stringify({
      at: Date.now(),
      status: {
        number: 1283, url: "https://github.com/jessepollak/home/pull/1283", title: "Save deposits",
        state: "open", headSha: "9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b", current: true, checks: "passing",
      },
    }));
    const view = render(<BuildChip build={{ ...build, pr: 1283 }} />);
    const link = await view.findByRole("link", { name: "#1283 · Open · Checks passing · 4f2a9c1" });
    expect(link.getAttribute("href")).toBe("https://github.com/jessepollak/home/pull/1283");
    expect(link.getAttribute("title")).toBe(`Save deposits · ${build.revision}`);
    expect(view.getByTitle("PR head is 9c8b7a6").textContent).toBe("Newer commit on PR");
  });

  test("renders the fetched status after a delayed successful read", async () => {
    const pull = deferred<Response>();
    const checks = deferred<Response>();
    const pending = [pull.promise, checks.promise];
    const previousFetch = globalThis.fetch;
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    globalThis.fetch = (() => pending.shift() ?? Promise.reject(new Error("Unexpected extra read"))) as unknown as typeof fetch;
    try {
      const view = render(<BuildChip build={{ ...build, pr: 999999 }} />);
      expect(view.getByTitle(build.revision).textContent).toBe("#999999 · 4f2a9c1");
      await act(async () => { pull.resolve(json({ title: "Deferred pull", state: "open", draft: false, merged_at: null, head: { sha: build.revision } })); });
      await act(async () => { checks.resolve(json({ check_runs: [{ status: "completed", conclusion: "success" }] })); });
      expect(view.getByTitle(`Deferred pull · ${build.revision}`).textContent).toBe("#999999 · Open · Checks passing · 4f2a9c1");
      expect(sessionStorage.getItem("review-pr:jessepollak/home#999999")).not.toBeNull();
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("keeps the fallback chip after the status read fails", async () => {
    const { promise, resolve } = deferred<Response>();
    const calls: string[] = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      calls.push(String(input));
      return promise;
    }) as unknown as typeof fetch;
    try {
      const view = render(<BuildChip build={{ ...build, pr: 999999 }} />);
      expect(calls).toEqual(["https://api.github.com/repos/jessepollak/home/pulls/999999"]);
      expect(view.getByTitle(build.revision).textContent).toBe("#999999 · 4f2a9c1");
      await act(async () => { resolve(new Response(null, { status: 503 })); });
      const link = view.getByTitle(build.revision);
      expect(link.getAttribute("href")).toBe("https://github.com/jessepollak/home/pull/999999");
      expect(view.queryByText("Newer commit on PR")).toBeNull();
      expect(sessionStorage.getItem("review-pr:jessepollak/home#999999")).toBeNull();
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
