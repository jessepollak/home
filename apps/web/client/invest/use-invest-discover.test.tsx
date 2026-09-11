import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import type { UseInvestDiscoverOptions } from "./use-invest-discover";

const { cleanup, render, waitFor, within } = await import("@testing-library/react");
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

function HookProbe({ options }: { options: UseInvestDiscoverOptions }) {
  const state = useInvestDiscover(options);
  const images = state.assetMarkResolution.images ?? {};
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
            return Response.json({
              version: 1,
              provider: "codex",
              fetchedAt: "2026-09-08T20:00:00.000Z",
              icons: { cbbtc: "https://icons.example.test/cbbtc.png" },
              memes: {
                status: "ready",
                assets: [
                  {
                    id: "degen",
                    category: "meme",
                    displayName: "Degen",
                    displaySymbol: "DEGEN",
                    initials: "DE",
                    chainId: 8453,
                    contractAddress: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed",
                    availability: "informational",
                    descriptor: "Farcaster-born community token",
                    representation: {
                      tokenSymbol: "DEGEN",
                      decimals: 18,
                      relationship: "Base ERC-20 token.",
                    },
                    contractUrl:
                      "https://basescan.org/token/0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed",
                    imageUrl: "https://icons.example.test/degen.png",
                  },
                  {
                    id: "toshi",
                    category: "meme",
                    displayName: "Toshi",
                    displaySymbol: "TOSHI",
                    initials: "TO",
                    chainId: 8453,
                    contractAddress: "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4",
                    availability: "informational",
                    descriptor: "Community meme and utility token",
                    representation: {
                      tokenSymbol: "TOSHI",
                      decimals: 18,
                      relationship: "Base ERC-20 token.",
                    },
                    contractUrl:
                      "https://basescan.org/token/0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4",
                    imageUrl: "https://icons.example.test/toshi.png",
                  },
                ],
                snapshots: [],
              },
            });
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
