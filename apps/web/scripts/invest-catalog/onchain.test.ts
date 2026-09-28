import { expect, test } from "bun:test";
import stocks from "../../config/invest-sources/base-stocks.json";
import wrapped from "../../config/invest-sources/coinbase-wrapped.json";
import { compareOnchain, type OnchainReads } from "./onchain";

const rows = [...stocks.stocks, ...wrapped.assets];
const rowFor = (address: string) => rows.find((row) => row.contract.toLowerCase() === address.toLowerCase())!;
const feedFor = (address: string) => stocks.stocks.find((row) => row.feed.proxy.toLowerCase() === address.toLowerCase())!;

const clean: OnchainReads = {
  token: async (address) => ({ symbol: rowFor(address).tokenSymbol, decimals: rowFor(address).decimals }),
  tokenName: async (address) => {
    const row = rowFor(address);
    return "onchainName" in row ? row.onchainName : row.tokenSymbol;
  },
  feed: async (address) => ({ description: feedFor(address).feed.description, decimals: feedFor(address).feed.decimals }),
  registryMultiplier: async () => BigInt("1000000000000000000"),
};

test("a clean onchain read reports no identity changes", async () => {
  expect(await compareOnchain(clean)).toEqual([]);
});


test("reads the onchain name only for assets that record one", async () => {
  const named: string[] = [];
  const changes = await compareOnchain({
    ...clean,
    tokenName: async (address) => {
      named.push(address.toLowerCase());
      if (!wrapped.assets.some((row) => row.contract.toLowerCase() === address.toLowerCase())) throw new Error("name read failed");
      return clean.tokenName(address);
    },
  });
  expect(changes).toEqual([]);
  expect(named).toHaveLength(wrapped.assets.length);
});
test.each([
  { label: "a removed registry entry", override: { registryMultiplier: async () => BigInt(0) }, key: "NVDAc", field: "registryMultiplier", actual: "0" },
  { label: "a changed token symbol", override: { token: async (address: string) => ({ symbol: `X${address.slice(0, 4)}`, decimals: rowFor(address).decimals }) }, key: "NVDAc", field: "symbol", actual: "X0xb2" },
  { label: "a changed wrapped name", override: { tokenName: async () => "Coinbase Wrapped Something Else" }, key: "cbBTC", field: "name", actual: "Coinbase Wrapped Something Else" },
  { label: "a changed feed description", override: { feed: async (address: string) => ({ description: `Renamed ${address.slice(0, 6)}`, decimals: feedFor(address).feed.decimals }) }, key: "NVDAc", field: "feedDescription", actual: "Renamed 0x0468" },
  { label: "changed feed decimals", override: { feed: async (address: string) => ({ description: feedFor(address).feed.description, decimals: 18 }) }, key: "NVDAc", field: "feedDecimals", actual: 18 },
] as const)("reports $label once", async ({ override, key, field, actual }) => {
  const changes = await compareOnchain({ ...clean, ...override } as OnchainReads);
  const matching = changes.filter((change) => change.key === key && change.field === field);
  expect(matching).toHaveLength(1);
  expect(matching[0]).toMatchObject({ key, field, actual });
});
