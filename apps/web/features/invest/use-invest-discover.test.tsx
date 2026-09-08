import "@/features/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import type { UseInvestDiscoverOptions } from "./use-invest-discover";

const { cleanup, render, waitFor, within } = await import("@testing-library/react");
const { useInvestDiscover } = await import("./use-invest-discover");

function page() {
  return within(document.body);
}

function HookProbe({ options }: { options: UseInvestDiscoverOptions }) {
  const state = useInvestDiscover(options);
  return (
    <div>
      <output data-testid="meme-status">{state.memeStatus}</output>
      <output data-testid="meme-name">{state.memeAssets[0]?.displayName ?? ""}</output>
      <output data-testid="icon">{state.assetIcons.cbbtc ?? "none"}</output>
    </div>
  );
}

afterEach(() => cleanup());

describe("useInvestDiscover", () => {
  test("loads trending memes and resolved icons from the public discover contract", async () => {
    render(
      <HookProbe
        options={{
          fetchImpl: async () =>
            Response.json({
              version: 1,
              provider: "codex",
              fetchedAt: "2026-09-08T20:00:00.000Z",
              icons: { cbbtc: "https://icons.example.test/btc.png" },
              memes: {
                status: "ready",
                assets: [
                  {
                    id: "base:0x1111111111111111111111111111111111111111",
                    category: "meme",
                    displayName: "Higher",
                    displaySymbol: "HIGHER",
                    initials: "HI",
                    chainId: 8453,
                    contractAddress: "0x1111111111111111111111111111111111111111",
                    availability: "informational",
                    descriptor: "Trending on Base",
                    representation: {
                      tokenSymbol: "HIGHER",
                      decimals: 18,
                      relationship: "Base ERC-20 token.",
                    },
                    contractUrl:
                      "https://basescan.org/token/0x1111111111111111111111111111111111111111",
                  },
                ],
                snapshots: [],
              },
            }),
        }}
      />,
    );

    await waitFor(() =>
      expect(page().getByTestId("meme-status").textContent).toBe("ready"),
    );
    expect(page().getByTestId("meme-name").textContent).toBe("Higher");
    expect(page().getByTestId("icon").textContent).toBe(
      "https://icons.example.test/btc.png",
    );
  });

  test("fail-closes to an empty error shelf on a malformed payload", async () => {
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
    expect(page().getByTestId("meme-name").textContent).toBe("");
  });
});
