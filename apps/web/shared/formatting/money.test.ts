import { describe, expect, test } from "bun:test";
import {
  MONEY_CHANGE_COLOR_TOKENS,
  formatChartPrice,
  formatFiatAmount,
  formatPercentage,
  formatPresentationDate,
  formatPresentationPrice,
  formatPresentationTokenAmount,
  formatSignedPercentChange,
  formatTokenAmount,
  formatUsdPrice,
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
    fiat: "R$ 1.234,56",
    token: "−123,45 USDC",
    compact: "R$ 64,21 mil",
    percentage: "4,50%",
    delta: "−0,67%",
    tiny: "R$ 0,0000001234",
    date: "7 de set. de 2026, 11:05",
  },
  {
    regionId: "AR" as const,
    currency: "ARS",
    fiat: "$ 1.234,56",
    token: "−123,45 USDC",
    compact: "$ 64,21 K",
    percentage: "4,50%",
    delta: "−0,67%",
    tiny: "$ 0,0000001234",
    date: "7 de sept de 2026, 11:05 a. m.",
  },
  {
    regionId: "ID" as const,
    currency: "IDR",
    fiat: "Rp 1.234,56",
    token: "−123,45 USDC",
    compact: "Rp 64,21 rb",
    percentage: "4,50%",
    delta: "−0,67%",
    tiny: "Rp 0,0000001234",
    date: "7 Sep 2026, 11.05",
  },
];

describe("presentation money formatting", () => {
  test.each(localeCases)(
    "formats amounts, compact values, signs, percentages, tiny prices, and dates for $regionId",
    (entry) => {
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
    },
  );

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

  test("keeps ordinary and tiny market prices exact within display bounds", () => {
    expect(formatUsdPrice("231.708792875")).toBe("$231.71");
    expect(formatUsdPrice("12345678901234567890.1")).toBe(
      "$12,345,678,901,234,567,890.10",
    );
    expect(formatUsdPrice("0.000123456789")).toBe("$0.0001235");
    expect(formatUsdPrice("1e-7")).toBe("$0.0000001");
    expect(formatUsdPrice("0.000000001")).toBe("<$0.00000001");
    expect(formatPresentationPrice("231.708792875", "BRL", "BR")).toBe(
      "R$ 231,71",
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
      neutral: "var(--home-muted)",
    });
  });

  test("keeps valuation wrappers on the shared exact formatter", () => {
    expect(formatFiatValue({ atoms: "4", scale: 3 }, "USD")).toBe("USD <0.01");
    expect(formatFiatValue({ atoms: "0", scale: 18 }, "USD")).toBe("USD 0.00");
    expect(presentationCurrencyName("USD")).toBe("US dollar");
    expect(formatPresentationFiat({ atoms: "481240", scale: 2 }, "IDR", 2, "ID")).toBe(
      "Rp 4.812,40",
    );
    expect(formatMoneyLabel("4,812.40", "BRL", "BR")).toBe("R$ 4.812,40");
  });
});
