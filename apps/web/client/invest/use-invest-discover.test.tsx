import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import type { UseInvestDiscoverOptions } from "./use-invest-discover";

const { cleanup, fireEvent, render, waitFor, within } = await import(
  "@testing-library/react"
);
const { useInvestDiscover } = await import("./use-invest-discover");

const CBBTC_KEY =
  "eip155:8453/erc20:0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf";
const DEGEN_KEY =
  "eip155:8453/erc20:0x4ed4e862860bed51a9570b96d89af5e1b0efefed";
const TOSHI_KEY =
  "eip155:8453/erc20:0xac1bd2486aaf3b5c0fc3fd868558b082a531b2b4";

function page() {
  return within(document.body);
}

function meme(
  id: string,
  name: string,
  symbol: string,
  address: string,
  imageUrl: string,
) {
  return {
    id,
    category: "meme",
    displayName: name,
    displaySymbol: symbol,
    initials: symbol.slice(0, 2),
    chainId: 8453,
    contractAddress: address,
    availability: "informational",
    descriptor: "Trending on Base",
    representation: {
      tokenSymbol: symbol,
      decimals: 18,
      relationship: "Base ERC-20 token.",
    },
    contractUrl: `https://basescan.org/token/${address}`,
    imageUrl,
  };
}

const degenAsset = meme(
  "degen",
  "Degen",
  "DEGEN",
  "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed",
  "https://icons.example.test/degen.png",
);
const toshiAsset = meme(
  "toshi",
  "Toshi",
  "TOSHI",
  "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4",
  "https://icons.example.test/toshi.png",
);
const higherAsset = meme(
  "base:0x1111111111111111111111111111111111111111",
  "Higher",
  "HIGHER",
  "0x1111111111111111111111111111111111111111",
  "https://icons.example.test/higher.png",
);

function discoverResponse(assets: unknown[], pagination: { nextOffset: number | null; exhausted: boolean }, icons = { cbbtc: "https://icons.example.test/cbbtc.png" }) {
  return Response.json({
    version: 1,
    provider: "codex",
    fetchedAt: "2026-09-08T20:00:00.000Z",
    icons,
    memes: {
      status: assets.length > 0 ? "ready" : "empty",
      assets,
      snapshots: [],
      ...pagination,
    },
  });
}

function HookProbe({ options }: { options: UseInvestDiscoverOptions }) {
  const state = useInvestDiscover(options);
  const images = state.assetMarkResolution.images ?? {};
  const pagination = state.memePagination;
  return (
    <div>
      <output data-testid="meme-status">{state.memeStatus}</output>
      <output data-testid="meme-names">
        {state.memeAssets.map((asset) => asset.displayName).join(",")}
      </output>
      <output data-testid="cbbtc-icon">{images[CBBTC_KEY] ?? "none"}</output>
      <output data-testid="degen-icon">{images[DEGEN_KEY] ?? "none"}</output>
      <output data-testid="toshi-icon">{images[TOSHI_KEY] ?? "none"}</output>
      <output data-testid="icons-pending">
        {state.assetMarkResolution.pending ? "yes" : "no"}
      </output>
      <output data-testid="next-offset">
        {pagination.nextOffset === null ? "null" : String(pagination.nextOffset)}
      </output>
      <output data-testid="exhausted">
        {pagination.exhausted ? "yes" : "no"}
      </output>
      <output data-testid="loading-more">
        {pagination.loadingMore ? "yes" : "no"}
      </output>
      <output data-testid="load-more-error">
        {pagination.loadMoreError ? "yes" : "no"}
      </output>
      <output data-testid="auto-load-paused">
        {pagination.autoLoadPaused ? "yes" : "no"}
      </output>
      <output data-testid="consecutive-empty">
        {String(pagination.consecutiveEmptyPages)}
      </output>
      <button type="button" onClick={state.loadMoreMemes}>
        load-more
      </button>
      <button type="button" onClick={state.retryLoadMoreMemes}>
        retry-load-more
      </button>
    </div>
  );
}

afterEach(() => cleanup());

describe("useInvestDiscover", () => {
  test("normalizes configured and supported meme images from one discover response", async () => {
    let discoverCalls = 0;
    render(
      <HookProbe
        options={{
          fetchImpl: async () => {
            discoverCalls += 1;
            return discoverResponse(
              [degenAsset, toshiAsset],
              { nextOffset: null, exhausted: true },
            );
          },
        }}
      />,
    );

    expect(page().getByTestId("icons-pending").textContent).toBe("yes");
    await waitFor(() =>
      expect(page().getByTestId("meme-status").textContent).toBe("ready"),
    );
    expect(page().getByTestId("meme-names").textContent).toBe("Degen,Toshi");
    expect(page().getByTestId("cbbtc-icon").textContent).toBe(
      "https://icons.example.test/cbbtc.png",
    );
    expect(page().getByTestId("degen-icon").textContent).toBe(
      "https://icons.example.test/degen.png",
    );
    expect(page().getByTestId("toshi-icon").textContent).toBe(
      "https://icons.example.test/toshi.png",
    );
    expect(page().getByTestId("icons-pending").textContent).toBe("no");
    expect(discoverCalls).toBe(1);
  });

  test("fail-closes the shared resolution to stable fallbacks on a malformed payload", async () => {
    render(
      <HookProbe
        options={{
          fetchImpl: async () => Response.json({ provider: "codex" }),
        }}
      />,
    );

    await waitFor(() =>
      expect(page().getByTestId("meme-status").textContent).toBe("error"),
    );
    expect(page().getByTestId("meme-names").textContent).toBe("");
    expect(page().getByTestId("cbbtc-icon").textContent).toBe("none");
    expect(page().getByTestId("degen-icon").textContent).toBe("none");
    expect(page().getByTestId("icons-pending").textContent).toBe("no");
  });
});

describe("useInvestDiscover pagination", () => {
  test("loads the next offset, appends unique assets, and reaches the end", async () => {
    const requested = new Set<string>();
    let upstreamCalls = 0;
    render(
      <HookProbe
        options={{
          fetchImpl: async (input) => {
            upstreamCalls += 1;
            const url = String(input);
            requested.add(url);
            if (url.includes("offset=24")) {
              return discoverResponse(
                [higherAsset],
                { nextOffset: null, exhausted: true },
              );
            }
            return discoverResponse(
              [degenAsset, toshiAsset],
              { nextOffset: 24, exhausted: false },
            );
          },
        }}
      />,
    );

    await waitFor(() =>
      expect(page().getByTestId("meme-status").textContent).toBe("ready"),
    );
    expect(page().getByTestId("meme-names").textContent).toBe("Degen,Toshi");
    expect(page().getByTestId("next-offset").textContent).toBe("24");
    expect(page().getByTestId("exhausted").textContent).toBe("no");

    fireEvent.click(page().getByRole("button", { name: "load-more" }));

    await waitFor(() =>
      expect(page().getByTestId("next-offset").textContent).toBe("null"),
    );
    expect(page().getByTestId("exhausted").textContent).toBe("yes");
    expect(page().getByTestId("meme-names").textContent).toBe(
      "Degen,Toshi,Higher",
    );
    expect(upstreamCalls).toBe(2);
    expect(requested.has("/api/invest/discover?offset=24")).toBe(true);
  });

  test("makes one in-flight request for concurrent load-more calls", async () => {
    let pageOneCalls = 0;
    const resolvers: Array<() => void> = [];
    render(
      <HookProbe
        options={{
          fetchImpl: async (input) => {
            if (String(input).includes("offset=24")) {
              pageOneCalls += 1;
              await new Promise<void>((resolve) => resolvers.push(resolve));
              return discoverResponse(
                [higherAsset],
                { nextOffset: null, exhausted: true },
              );
            }
            return discoverResponse(
              [degenAsset],
              { nextOffset: 24, exhausted: false },
            );
          },
        }}
      />,
    );

    await waitFor(() =>
      expect(page().getByTestId("meme-status").textContent).toBe("ready"),
    );
    fireEvent.click(page().getByRole("button", { name: "load-more" }));
    fireEvent.click(page().getByRole("button", { name: "load-more" }));
    fireEvent.click(page().getByRole("button", { name: "load-more" }));
    await waitFor(() => expect(pageOneCalls).toBe(1));

    resolvers.forEach((resolve) => resolve());
    await waitFor(() =>
      expect(page().getByTestId("meme-names").textContent).toBe(
        "Degen,Higher",
      ),
    );
    expect(pageOneCalls).toBe(1);
  });

  test("keeps loaded content and offers retry when a page fails", async () => {
    let failNextPage = true;
    render(
      <HookProbe
        options={{
          fetchImpl: async (input) => {
            if (String(input).includes("offset=24")) {
              if (failNextPage) {
                return Response.json({ nope: true }, { status: 500 });
              }
              return discoverResponse(
                [higherAsset],
                { nextOffset: null, exhausted: true },
              );
            }
            return discoverResponse(
              [degenAsset],
              { nextOffset: 24, exhausted: false },
            );
          },
        }}
      />,
    );

    await waitFor(() =>
      expect(page().getByTestId("meme-status").textContent).toBe("ready"),
    );
    fireEvent.click(page().getByRole("button", { name: "load-more" }));

    await waitFor(() =>
      expect(page().getByTestId("load-more-error").textContent).toBe("yes"),
    );
    // Loaded content is preserved on a transient failure.
    expect(page().getByTestId("meme-names").textContent).toBe("Degen");
    expect(page().getByTestId("next-offset").textContent).toBe("24");

    failNextPage = false;
    fireEvent.click(page().getByRole("button", { name: "retry-load-more" }));

    await waitFor(() =>
      expect(page().getByTestId("meme-names").textContent).toBe(
        "Degen,Higher",
      ),
    );
    expect(page().getByTestId("exhausted").textContent).toBe("yes");
  });

  test("does not refetch the same offset twice", async () => {
    let offset24Calls = 0;
    const nextOffset = 24;
    render(
      <HookProbe
        options={{
          fetchImpl: async (input) => {
            if (String(input).includes("offset=24")) {
              offset24Calls += 1;
              return discoverResponse(
                [higherAsset],
                { nextOffset: null, exhausted: true },
              );
            }
            return discoverResponse(
              [degenAsset],
              { nextOffset, exhausted: false },
            );
          },
        }}
      />,
    );

    await waitFor(() =>
      expect(page().getByTestId("meme-status").textContent).toBe("ready"),
    );
    fireEvent.click(page().getByRole("button", { name: "load-more" }));
    await waitFor(() => expect(offset24Calls).toBe(1));
    await waitFor(() =>
      expect(page().getByTestId("exhausted").textContent).toBe("yes"),
    );

    fireEvent.click(page().getByRole("button", { name: "load-more" }));
    expect(offset24Calls).toBe(1);
  });

  test("surfaces a provider error envelope as a retryable failure, not the end state", async () => {
    let failNextPage = true;
    render(
      <HookProbe
        options={{
          fetchImpl: async (input) => {
            if (String(input).includes("offset=24")) {
              if (failNextPage) {
                return Response.json({
                  version: 1,
                  provider: "codex",
                  fetchedAt: "2026-09-08T20:00:00.000Z",
                  icons: { cbbtc: null },
                  memes: {
                    status: "error",
                    message: "envelope failed",
                    assets: [],
                    snapshots: [],
                    nextOffset: null,
                    exhausted: true,
                  },
                });
              }
              return discoverResponse(
                [higherAsset],
                { nextOffset: null, exhausted: true },
              );
            }
            return discoverResponse(
              [degenAsset],
              { nextOffset: 24, exhausted: false },
            );
          },
        }}
      />,
    );

    await waitFor(() =>
      expect(page().getByTestId("meme-status").textContent).toBe("ready"),
    );
    fireEvent.click(page().getByRole("button", { name: "load-more" }));

    await waitFor(() =>
      expect(page().getByTestId("load-more-error").textContent).toBe("yes"),
    );
    // Accumulated rows and the same offset survive an error envelope.
    expect(page().getByTestId("meme-names").textContent).toBe("Degen");
    expect(page().getByTestId("next-offset").textContent).toBe("24");
    expect(page().getByTestId("exhausted").textContent).toBe("no");

    failNextPage = false;
    fireEvent.click(page().getByRole("button", { name: "retry-load-more" }));
    await waitFor(() =>
      expect(page().getByTestId("meme-names").textContent).toBe(
        "Degen,Higher",
      ),
    );
  });

  test("treats a rejected page request (timeout) as retryable", async () => {
    let failNextPage = true;
    render(
      <HookProbe
        options={{
          fetchImpl: async (input) => {
            if (String(input).includes("offset=24")) {
              if (failNextPage) throw new Error("AbortError: timed out");
              return discoverResponse(
                [higherAsset],
                { nextOffset: null, exhausted: true },
              );
            }
            return discoverResponse(
              [degenAsset],
              { nextOffset: 24, exhausted: false },
            );
          },
        }}
      />,
    );

    await waitFor(() =>
      expect(page().getByTestId("meme-status").textContent).toBe("ready"),
    );
    fireEvent.click(page().getByRole("button", { name: "load-more" }));

    await waitFor(() =>
      expect(page().getByTestId("load-more-error").textContent).toBe("yes"),
    );
    expect(page().getByTestId("meme-names").textContent).toBe("Degen");
    expect(page().getByTestId("next-offset").textContent).toBe("24");

    failNextPage = false;
    fireEvent.click(page().getByRole("button", { name: "retry-load-more" }));
    await waitFor(() =>
      expect(page().getByTestId("meme-names").textContent).toBe(
        "Degen,Higher",
      ),
    );
  });

  test("continues loading from an initially-empty catalog page", async () => {
    render(
      <HookProbe
        options={{
          fetchImpl: async (input) => {
            if (String(input).includes("offset=24")) {
              return discoverResponse(
                [higherAsset],
                { nextOffset: null, exhausted: true },
              );
            }
            // Initial page: provider still has rows, but none normalize usable.
            return discoverResponse([], { nextOffset: 24, exhausted: false });
          },
        }}
      />,
    );

    await waitFor(() =>
      expect(page().getByTestId("meme-status").textContent).toBe("empty"),
    );
    expect(page().getByTestId("next-offset").textContent).toBe("24");

    fireEvent.click(page().getByRole("button", { name: "load-more" }));
    await waitFor(() =>
      expect(page().getByTestId("meme-names").textContent).toBe("Higher"),
    );
    expect(page().getByTestId("exhausted").textContent).toBe("yes");
  });

  test("auto-continues through a page that returns no new assets", async () => {
    render(
      <HookProbe
        options={{
          fetchImpl: async (input) => {
            if (String(input).includes("offset=24")) {
              return discoverResponse(
                [degenAsset], // duplicate of the already-loaded row
                { nextOffset: 48, exhausted: false },
              );
            }
            if (String(input).includes("offset=48")) {
              return discoverResponse(
                [higherAsset],
                { nextOffset: null, exhausted: true },
              );
            }
            return discoverResponse(
              [degenAsset],
              { nextOffset: 24, exhausted: false },
            );
          },
        }}
      />,
    );

    await waitFor(() =>
      expect(page().getByTestId("meme-status").textContent).toBe("ready"),
    );
    fireEvent.click(page().getByRole("button", { name: "load-more" }));

    await waitFor(() =>
      expect(page().getByTestId("next-offset").textContent).toBe("48"),
    );
    expect(page().getByTestId("auto-load-paused").textContent).toBe("no");
    expect(page().getByTestId("consecutive-empty").textContent).toBe("1");
    expect(page().getByTestId("meme-names").textContent).toBe("Degen");

    fireEvent.click(page().getByRole("button", { name: "load-more" }));
    await waitFor(() =>
      expect(page().getByTestId("meme-names").textContent).toBe(
        "Degen,Higher",
      ),
    );
    expect(page().getByTestId("exhausted").textContent).toBe("yes");
  });

  test("pauses auto-loading only after the consecutive empty-page bound", async () => {
    let offset96Calls = 0;
    render(
      <HookProbe
        options={{
          fetchImpl: async (input) => {
            const url = String(input);
            if (url.includes("offset=24")) {
              return discoverResponse([], { nextOffset: 48, exhausted: false });
            }
            if (url.includes("offset=48")) {
              return discoverResponse([], { nextOffset: 72, exhausted: false });
            }
            if (url.includes("offset=72")) {
              return discoverResponse([], { nextOffset: 96, exhausted: false });
            }
            if (url.includes("offset=96")) {
              offset96Calls += 1;
              return discoverResponse(
                [higherAsset],
                { nextOffset: null, exhausted: true },
              );
            }
            return discoverResponse(
              [degenAsset],
              { nextOffset: 24, exhausted: false },
            );
          },
        }}
      />,
    );

    await waitFor(() =>
      expect(page().getByTestId("meme-status").textContent).toBe("ready"),
    );

    fireEvent.click(page().getByRole("button", { name: "load-more" }));
    await waitFor(() =>
      expect(page().getByTestId("consecutive-empty").textContent).toBe("1"),
    );
    expect(page().getByTestId("auto-load-paused").textContent).toBe("no");

    fireEvent.click(page().getByRole("button", { name: "load-more" }));
    await waitFor(() =>
      expect(page().getByTestId("consecutive-empty").textContent).toBe("2"),
    );
    expect(page().getByTestId("auto-load-paused").textContent).toBe("no");

    fireEvent.click(page().getByRole("button", { name: "load-more" }));
    await waitFor(() =>
      expect(page().getByTestId("auto-load-paused").textContent).toBe("yes"),
    );
    expect(page().getByTestId("consecutive-empty").textContent).toBe("3");
    expect(page().getByTestId("next-offset").textContent).toBe("96");

    // Paused auto-loading never advances to offset 96 on its own.
    fireEvent.click(page().getByRole("button", { name: "load-more" }));
    expect(offset96Calls).toBe(0);
    expect(page().getByTestId("auto-load-paused").textContent).toBe("yes");
  });

  test("a late background refresh cannot overwrite appended rows", async () => {
    const releaseRefresh: Array<() => void> = [];
    let pageZeroCalls = 0;
    render(
      <HookProbe
        options={{
          refreshCooldownMs: 0,
          fetchImpl: async (input) => {
            const url = String(input);
            if (!url.includes("offset=")) {
              pageZeroCalls += 1;
              if (pageZeroCalls > 1) {
                // A background visibility refresh stays in-flight.
                await new Promise<void>((resolve) => {
                  releaseRefresh.push(resolve);
                });
              }
              return discoverResponse(
                [degenAsset],
                { nextOffset: 24, exhausted: false },
              );
            }
            return discoverResponse(
              [higherAsset],
              { nextOffset: null, exhausted: true },
            );
          },
        }}
      />,
    );

    await waitFor(() =>
      expect(page().getByTestId("meme-status").textContent).toBe("ready"),
    );

    // Start a background visibility refresh and wait until it is in-flight.
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(releaseRefresh.length).toBe(1));

    // Start pagination while that refresh is still in-flight.
    fireEvent.click(page().getByRole("button", { name: "load-more" }));
    await waitFor(() =>
      expect(page().getByTestId("meme-names").textContent).toBe(
        "Degen,Higher",
      ),
    );

    // Let the stale refresh resolve; it must not clobber the appended rows.
    releaseRefresh.forEach((resolve) => resolve());
    expect(page().getByTestId("meme-names").textContent).toBe("Degen,Higher");
    expect(page().getByTestId("exhausted").textContent).toBe("yes");
  });
});
