import { expect, test } from "bun:test";
import { getDirectPortfolioAssets } from "@/config/portfolio-assets";
import { createConfiguredErc20BalanceReader } from "./inventory-erc20-rpc";

const liveTest = process.env.PORTFOLIO_ERC20_LIVE_SMOKE === "1" ? test : test.skip;
const PUBLIC_TEST_OWNER = "0x1111111111111111111111111111111111111111" as const;

liveTest(
  "configured Base RPC returns authoritative quantities for the affected contract class",
  async () => {
    const rpcUrl = process.env.BASE_RPC_URL?.trim();
    expect(rpcUrl).toBeTruthy();
    const affectedIds = new Set(["toshi", "cbxrp", "cbdoge", "cbltc"]);
    const requests = getDirectPortfolioAssets()
      .filter(
        (asset): asset is typeof asset & { contractAddress: `0x${string}` } =>
          asset.kind === "erc20" &&
          asset.contractAddress !== null &&
          affectedIds.has(asset.id),
      )
      .map(({ id, contractAddress }) => ({ id, contractAddress }));
    expect(requests).toHaveLength(4);

    const balances = await createConfiguredErc20BalanceReader({
      rpcUrl: rpcUrl!,
    })(requests, PUBLIC_TEST_OWNER, new AbortController().signal);

    expect(balances.size).toBe(4);
    for (const { id } of requests) {
      expect(balances.get(id)).toMatch(/^(?:0|[1-9]\d*)$/);
    }
  },
  20_000,
);
