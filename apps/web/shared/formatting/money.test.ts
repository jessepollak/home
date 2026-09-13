import { describe, expect, test } from "bun:test";
import {
  MONEY_CHANGE_COLOR_TOKENS,
  formatBasisPoints,
  formatChartPrice,
  formatExactPresentationTokenAmount,
  formatFiatAmount,
  formatHealthFactor,
  formatOracleUsd,
  formatPercentage,
  formatPresentationDate,
  formatPresentationPrice,
  formatPresentationTokenAmount,
  formatSignedPercentChange,
  formatTokenAmount,
  formatUnsignedTokenAmount,
  formatUsdPrice,
  formatUsdStablecoinAmount,
  formatWadPercent,
  moneyChangeTone,
  presentationAssetClass,
  presentationMoneyMetadata,
  scaleDecimalByExact,
  type AtomicAmount,
} from "./money";
import {
  formatFiatValue,
  formatMoneyLabel,
  formatPresentationFiat,
  presentationCurrencyName,
} from "@/shared/portfolio/valuation-format";

const localeCases = [
  {
    regionId: "GLOBAL" as const,
    currency: "USD",
    fiat: "$1,234.56",
    token: "−123.45 USDC",
    compact: "$64.21K",
    percentage: "4.50%",
    delta: "−0.67%",
    tiny: "$0.0000001234",
    date: "Sep 7, 2026, 11:05 AM",
  },
  {
    regionId: "BR" as const,
    currency: "BRL",
    fiat: "R$\u00A01.234,56",
    token: "−123,45 USDC",
    compact: "R$\u00A064,21 mil",
    percentage: "4,50%",
    delta: "−0,67%",
    tiny: "R$\u00A00,0000001234",
    date: "7 de set. de 2026, 11:05",
  },
  {
    regionId: "AR" as const,
    currency: "ARS",
    fiat: "$1.234,56",
    token: "−123,45 USDC",
    compact: "$64,21K",
    percentage: "4,50%",
    delta: "−0,67%",
    tiny: "$0,0000001234",
    date: "7 de sept de 2026, 11:05 a. m.",
  },
  {
    regionId: "ID" as const,
    currency: "IDR",
    fiat: "Rp\u00A01.234,56",
    token: "−123,45 USDC",
    compact: "Rp\u00A064,21 rb",
    percentage: "4,50%",
    delta: "−0,67%",
    tiny: "Rp\u00A00,0000001234",
    date: "7 Sep 2026, 11.05",
  },
];

describe("presentation money formatting", () => {
  test("keeps internal spaces in multi-word token labels", () => {
    expect(formatPresentationTokenAmount("999999", 18, "vault shares")).toBe("<0.000001 vault shares");
    expect(formatPresentationTokenAmount("1500000000000000000", 18, "vault shares", { useNoBreakSpace: true }))
      .toMatch(/^\S+\u00a0vault\u00a0shares$/);
  });

  test("formats amounts, signs, percentages, prices, and dates for every locale", () => {
    for (const entry of localeCases) {
      expect(
        formatFiatAmount(BigInt("123456"), 2, entry.currency, {
          regionId: entry.regionId,
        }),
      ).toBe(entry.fiat);
      expect(
        formatPresentationTokenAmount(
          BigInt("-123456789"),
          6,
          "USDC",
          { cashCurrency: "USD", regionId: entry.regionId },
        ),
      ).toBe(entry.token);
      expect(
        formatChartPrice("64210", {
          currency: entry.currency,
          regionId: entry.regionId,
        }),
      ).toBe(entry.compact);
      expect(formatPercentage(0.045, entry.regionId)).toBe(entry.percentage);
      expect(formatSignedPercentChange("-0.667%", entry.regionId)).toBe(
        entry.delta,
      );
      expect(
        formatChartPrice("0.0000001234", {
          currency: entry.currency,
          regionId: entry.regionId,
        }),
      ).toBe(entry.tiny);
      expect(
        formatPresentationDate("2026-09-07T11:05:00.000Z", {
          regionId: entry.regionId,
          timeZone: "UTC",
          style: "activity-full",
        }),
      ).toBe(entry.date);
    }
  });

  test("derives locale and currency metadata from presentation regions", () => {
    expect(presentationMoneyMetadata()).toMatchObject({
      regionId: "GLOBAL",
      locale: ["en", "US"].join("-"),
      currency: "USD",
    });
    expect(presentationMoneyMetadata("BR")).toMatchObject({
      locale: "pt-BR",
      currency: "BRL",
      currencyName: "Brazilian real",
      currencySymbol: "R$",
    });
  });

  test("keeps token amounts exact and bounded without Number conversion", () => {
    const cases: Array<[AtomicAmount, number, number | undefined, string]> = [
      [BigInt("1234567890123456789012345"), 6, undefined, "1,234,567,890,123,456,789.012345"],
      [BigInt("1234500"), 6, undefined, "1.2345"],
      [BigInt("1234567"), 0, undefined, "1,234,567"],
      [BigInt("1"), 18, undefined, "<0.000001"],
      [BigInt("0"), 18, undefined, "0"],
      [BigInt("-1234500"), 6, undefined, "−1.2345"],
    ];
    for (const [amount, decimals, maximumFractionDigits, expected] of cases) {
      expect(formatTokenAmount(amount, decimals, maximumFractionDigits)).toBe(expected);
    }
    expect(() => formatTokenAmount("01", 6)).toThrow(TypeError);
    expect(() => formatTokenAmount(BigInt(1), 6, 7)).toThrow(TypeError);
  });

  test("applies presentation caps for majors, stables, and memes", () => {
    expect(presentationAssetClass({ symbol: "ETH" })).toBe("major");
    expect(presentationAssetClass({ symbol: "USDC" })).toBe("stable");
    expect(presentationAssetClass({ symbol: "DEGEN" })).toBe("meme");
    expect(
      formatPresentationTokenAmount(BigInt("1101012331497033445"), 18, "ETH"),
    ).toBe("1.1010 ETH");
    expect(
      formatPresentationTokenAmount(BigInt("10000000"), 6, "USDC", {
        cashCurrency: "USD",
      }),
    ).toBe("10.00 USDC");
    expect(
      formatPresentationTokenAmount(
        BigInt("45690152000000000000000000"),
        18,
        "JESSE",
        { category: "meme" },
      ),
    ).toBe("45,690,152 JESSE");
  });

  test("centralizes exact token, fiat, WAD, basis-point, health, and oracle formatting", () => {
    const cases = [
      { actual: formatUnsignedTokenAmount("1234560000", 6), expected: "1,234.56" },
      { actual: formatExactPresentationTokenAmount("1", 18, "ETH", { useNoBreakSpace: true }), expected: "0.000000000000000001\u00A0ETH" },
      { actual: formatUsdStablecoinAmount("1234560000"), expected: "$1,234.56" },
      { actual: formatUsdStablecoinAmount("1000001"), expected: "$1.000001" },
      { actual: formatFiatAmount("1234.565", "USD"), expected: "$1,234.56" },
      { actual: formatWadPercent("455000000000000"), expected: "0.05%" },
      { actual: formatBasisPoints("455"), expected: "4.55%" },
      { actual: formatHealthFactor("1235000000000000000"), expected: "1.24" },
      { actual: formatHealthFactor(null), expected: "No debt" },
      { actual: formatOracleUsd("800000000000000000000000000000000000000"), expected: "$80,000.00" },
    ];
    for (const entry of cases) expect(entry.actual).toBe(entry.expected);

    expect(formatPresentationTokenAmount("bad", 6, "USDC")).toBe("—");
    expect(formatFiatAmount("-1", "USD")).toBe("—");
    expect(() => formatUnsignedTokenAmount("-1", 6)).toThrow(TypeError);
    expect(() => formatWadPercent("-1")).toThrow(TypeError);
    expect(() => formatBasisPoints("-1")).toThrow(TypeError);
    expect(() => formatHealthFactor("-1")).toThrow(TypeError);
    expect(() => formatOracleUsd("-1")).toThrow(TypeError);
  });

  test("keeps ordinary and tiny market prices exact within display bounds", () => {
    expect(formatUsdPrice("231.708792875")).toBe("$231.71");
    expect(formatUsdPrice("12345678901234567890.1")).toBe(
      "$12,345,678,901,234,567,890.10",
    );
    expect(formatUsdPrice("0.000123456789")).toBe("$0.0001235");
    expect(formatUsdPrice("1e-7")).toBe("$0.0000001");
    expect(formatUsdPrice("0.000000001")).toBe("<$0.00000001");
    expect(formatPresentationPrice("231.708792875", "BRL", "BR")).toBe(
      "R$\u00A0231,71",
    );
    expect(formatChartPrice("0.0123456")).toBe("$0.012346");
    expect(formatChartPrice("1.234e-7")).toBe("$0.0000001234");
    expect(formatUsdPrice("not-a-price")).toBeNull();
    expect(formatUsdPrice(Number.POSITIVE_INFINITY)).toBeNull();
  });

  test("scales exact prices and rejects invalid factors", () => {
    expect(
      scaleDecimalByExact("231.708792875", { atoms: "16425", scale: 0 }),
    ).toBe("3805816.922971875");
    expect(scaleDecimalByExact("1", { atoms: "0", scale: 0 })).toBe("0");
    expect(scaleDecimalByExact("bad", { atoms: "1", scale: 0 })).toBeNull();
  });

  test("uses explicit unicode sign policy and semantic color tokens", () => {
    expect(formatSignedPercentChange("+9.8%")).toBe("+9.80%");
    expect(formatSignedPercentChange("-0.667%")).toBe("−0.67%");
    expect(formatSignedPercentChange("−0.67%")).toBe("−0.67%");
    expect(formatSignedPercentChange(0)).toBe("+0.00%");
    expect(moneyChangeTone("+1.00%")).toBe("positive");
    expect(moneyChangeTone("−1.00%")).toBe("negative");
    expect(moneyChangeTone("—")).toBe("neutral");
    expect(MONEY_CHANGE_COLOR_TOKENS).toEqual({
      positive: "var(--home-positive)",
      negative: "var(--home-negative)",
      neutral: "var(--home-text-muted)",
    });
  });

  test("returns a deterministic unavailable value for malformed dates", () => {
    expect(formatPresentationDate("not-a-date", {
      timeZone: "UTC",
      style: "activity-full",
    })).toBe("—");
  });

  test("keeps valuation wrappers on the shared exact formatter", () => {
    expect(formatFiatValue({ atoms: "4", scale: 3 }, "USD")).toBe("USD <0.01");
    expect(formatFiatValue({ atoms: "0", scale: 18 }, "USD")).toBe("USD 0.00");
    expect(presentationCurrencyName("USD")).toBe("US dollar");
    expect(formatPresentationFiat({ atoms: "481240", scale: 2 }, "IDR", 2, "ID")).toBe(
      "Rp\u00A04.812,40",
    );
    expect(formatMoneyLabel("4,812.40", "BRL", "BR")).toBe("R$\u00A04.812,40");
  });
});
