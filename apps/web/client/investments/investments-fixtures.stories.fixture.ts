import { BASE_CHAIN_ID, cryptoAssets, stockAssets, type InvestAsset } from "@/config/invest-assets";
import { createBlockedAccountWalletClient } from "@/client/account/cdp-client";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { borrowPosition, buildBalancesSnapshotFixture, priced, pricedCash, ready, unavailableBalance, walletHolding } from "@/shared/balances/fixtures";
import type { BalancesSnapshot } from "@/shared/balances/types";

const stock = stockAssets[0]!;
export const longToken = walletHolding({ address: "0x6666666666666666666666666666666666666666", name: "A Very Long Discovered Investment Token Name", symbol: "LONG", decimals: 18 }, "1200000000000000000", priced("USD", "1234567890"));
export const walletToken = walletHolding({ address: "0x5555555555555555555555555555555555555555", name: "Aerodrome", symbol: "AERO", decimals: 18, imageUrl: "https://assets.example.invalid/aero.svg" }, "1200000000000000000", priced("USD", "25000"));
export const tinyToken = walletHolding({ address: "0x7777777777777777777777777777777777777777", name: "Tiny token", symbol: "TINY", decimals: 18 }, "1000000000000000000", priced("USD", "5", 3));
export const unpricedToken = walletHolding({ address: "0x8888888888888888888888888888888888888888", name: "Unpriced token", symbol: "UNP", decimals: 18 }, "1000000000000000000", { status: "unpriced", reason: "price-unavailable" });
const collateralToken = walletHolding({ address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", name: "Staked token", symbol: "STK", decimals: 18 }, "1000000000000000000", priced("USD", "500"));
export const fallbackToken = walletHolding({ address: "0x9999999999999999999999999999999999999999", name: "", symbol: "FALL", decimals: 18 }, "1000000000000000000", priced("USD", "250"));
const discoveredMemeAddress = "0xdddddddddddddddddddddddddddddddddddddddd" as const;
export const discoveredMemeAsset: InvestAsset = { id: `base:${discoveredMemeAddress}`, category: "meme", displayName: "Discovered meme", displaySymbol: "MEME", initials: "ME", chainId: BASE_CHAIN_ID, contractAddress: discoveredMemeAddress, availability: "informational", descriptor: "Meme token on Base", representation: { tokenSymbol: "MEME", decimals: 18, relationship: "Token on Base" }, contractUrl: `https://basescan.org/token/${discoveredMemeAddress}` };
const discoveredMemeHolding = walletHolding({ address: discoveredMemeAddress.toUpperCase().replace("0X", "0x"), name: "Discovered meme", symbol: "MEME", decimals: 18 }, "1000000000000000000", priced("USD", "4200"));
const firstTiedToken = walletHolding({ address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", name: "Twin token", symbol: "TWIN", decimals: 18 }, "1000000000000000000", priced("USD", "12000"));
const secondTiedToken = walletHolding({ address: "0xffffffffffffffffffffffffffffffffffffffff", name: "Twin token", symbol: "TWIN", decimals: 18 }, "1000000000000000000", priced("USD", "12000"));
export const discoveredMemeSnapshot = buildBalancesSnapshotFixture({ catalog: [discoveredMemeHolding] });
export const tiedTokensSnapshot = buildBalancesSnapshotFixture({ catalog: [secondTiedToken, firstTiedToken] });
export const duplicateNamesSnapshot = buildBalancesSnapshotFixture({ catalog: [secondTiedToken, firstTiedToken, fallbackToken] });
export const reversedTiedTokensSnapshot = buildBalancesSnapshotFixture({ catalog: [firstTiedToken, secondTiedToken] });
export const collateral = borrowPosition({ collateralBaseUnits: "50000000", collateralValue: priced("USD", "3500000"), debtBaseUnits: "100000000", debtValue: priced("USD", "10000") });
export const cashRegistry = { usdc: { balance: ready("234000000"), value: priced("USD", "23400"), cashValue: pricedCash("USD", "23400") }, idrx: { balance: ready("190000000"), value: priced("USD", "11700"), cashValue: pricedCash("IDR", "190000000", 2) } };
export const investmentRegistry = { cbbtc: { balance: ready("80000000"), value: priced("USD", "5600000") }, eth: { balance: ready("1000000000000000000"), value: priced("USD", "320000") }, nvdac: { balance: ready("200000000"), value: priced("USD", "45000") } };
export const fundedSnapshot = buildBalancesSnapshotFixture({ registry: { ...investmentRegistry }, catalog: [walletToken, tinyToken], borrow: { coverage: "complete", positions: [collateral] } });
export const manyHoldingsSnapshot = buildBalancesSnapshotFixture({ catalog: [walletToken, ...Array.from({ length: 59 }, (_, index) => walletHolding({ address: `0x${(index + 1).toString(16).padStart(40, "0")}`, name: `Holding ${String(index + 1).padStart(2, "0")}`, symbol: String.fromCharCode(65 + Math.floor(index / 26), 65 + index % 26), decimals: 18 }, "1000000000000000000", priced("USD", String(6000 - index * 100))))] });
export const narrowSnapshot = buildBalancesSnapshotFixture({ registry: { ...investmentRegistry }, catalog: [walletToken, tinyToken, longToken], borrow: { coverage: "complete", positions: [collateral] } });
export const largeValueSnapshot = buildBalancesSnapshotFixture({ catalog: [walletHolding({ address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", name: "Large investment", symbol: "BIG", decimals: 18 }, "1000000000000000000", priced("USD", "123456789012345"))] });
export const sharedPortfolioSnapshot = buildBalancesSnapshotFixture({ registry: { ...cashRegistry, ...investmentRegistry }, catalog: [walletToken, tinyToken], borrow: { coverage: "complete", positions: [collateral] } });
export const singleSnapshot = buildBalancesSnapshotFixture({ registry: { cbbtc: investmentRegistry.cbbtc } });
export const emptySnapshot = buildBalancesSnapshotFixture();
export const partialSnapshot = buildBalancesSnapshotFixture({ registry: { cbbtc: investmentRegistry.cbbtc, eth: { balance: unavailableBalance, value: { status: "unavailable" } } } });
export const unreadSnapshot = buildBalancesSnapshotFixture({ registry: { eth: { balance: unavailableBalance, value: { status: "unavailable" } } } });
export const unpricedSnapshot = buildBalancesSnapshotFixture({ catalog: [unpricedToken] });
export const metadataFallbackSnapshot = buildBalancesSnapshotFixture({ catalog: [fallbackToken] });
export const collateralSnapshot = buildBalancesSnapshotFixture({ registry: { cbbtc: investmentRegistry.cbbtc }, borrow: { coverage: "complete", positions: [collateral, { ...collateral, marketId: `0x${"1".repeat(64)}`, collateral: { ...collateral.collateral, key: collateralToken.key, name: collateralToken.name, symbol: collateralToken.symbol, decimals: 18, contractAddress: collateralToken.contractAddress, balance: { status: "ready", baseUnits: "1000000000000000000" }, value: priced("USD", "500"), collateral: { marketId: `0x${"1".repeat(64)}` } } }] } });
export const collateralPartialInventorySnapshot = buildBalancesSnapshotFixture({ coverage: { catalog: "incomplete" }, borrow: collateralSnapshot.borrow });
export const collateralKnownZeroSnapshot = buildBalancesSnapshotFixture({ registry: { cbbtc: { balance: ready("0"), value: { status: "unpriced", reason: "price-unavailable" } } }, coverage: { catalog: "incomplete" }, borrow: { coverage: "complete", positions: [collateral] } });
export const collateralUnavailableSnapshot = buildBalancesSnapshotFixture({ registry: { cbbtc: { balance: unavailableBalance, value: { status: "unavailable" } } }, coverage: { registry: "complete", catalog: "complete" }, borrow: { coverage: "complete", positions: [collateral] } });
export const notListedSnapshot: BalancesSnapshot = buildBalancesSnapshotFixture({ catalog: [unpricedToken] });
export const bitcoinAsset = cryptoAssets.find((asset) => asset.id === "cbbtc")!;
export const stockAsset = stock;
export const investmentMarkSvg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><circle cx='20' cy='20' r='20' fill='#0a695f'/><path d='M10 27 20 9l10 18' fill='none' stroke='white' stroke-width='4'/></svg>";

export function createInvestmentsStoryWalletClient(snapshot: BalancesSnapshot = sharedPortfolioSnapshot) {
  const storySession: VerifiedAccountSession = { user: { subject: "synthetic-investments-owner" }, smartAccount: { address: snapshot.owner.address, chainId: 8453 }, accountProvider: "cdp-embedded" };
  return {
    ...createBlockedAccountWalletClient("provider-unavailable"),
    status: "verified" as const,
    verification: "server" as const,
    session: storySession,
    fetchBalances: async () => snapshot,
    fetchAccountResource: async (path: string) => path === "/api/trades"
      ? { version: 1, status: "available" }
      : path === "/api/trades/stock-eligibility"
        ? { version: 1, buy: "eligible", sell: "eligible" }
        : Promise.reject(new Error("Resource unavailable in investments story")),
  };
}
