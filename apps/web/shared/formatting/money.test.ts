import { describe, expect, test } from "bun:test";
import {
  MONEY_CHANGE_COLOR_TOKENS,
  formatBasisPoints,
  formatWadFeePercent,
  formatChartPrice,
  formatExactPresentationCashAmount,
  formatExactPresentationTokenAmount,
  formatFiatAmount,
  formatHealthFactor,
  formatOracleUsd,
  formatPercentage,
  formatPresentationPercentage,
  formatPresentationDate,
  formatPresentationDateRange,
  formatPresentationPrice,
  formatPresentationTokenAmount,
  formatPresentationTokenAmountParts,
  formatSignedPercentChange,
  formatTokenAmount,
  formatTrimmedChartPrice,
  formatUnsignedTokenAmount,
  formatUsdStablecoinAmount,
  formatWadPercent,
  moneyChangeTone,
  presentationAssetClass,
  presentationMoneyMetadata,
  scaleDecimalByExact,
  type AtomicAmount,
} from "./money";
import {
  formatPresentationFiat,
  formatPresentationCashAmount,
  presentationCurrencyName,
} from "@/shared/formatting";

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

describe("explicit fiat presentation modes", () => {
  test("the same currency uses the chosen region's separators", () => {
    const us = formatFiatAmount("1234.56", "USD", { regionId: "US" });
    const br = formatFiatAmount("1234.56", "USD", { regionId: "BR" });
    expect(us).toBe("$1,234.56");
    expect(br).toContain("1.234,56");
    expect(br).not.toBe(us);
  });

  test("currency-native amounts match their currency's region", () => {
    expect(formatFiatAmount("1234.56", "BRL", { currencyNative: true }))
      .toBe(formatFiatAmount("1234.56", "BRL", { regionId: "BR" }));
    expect(formatFiatAmount("1234.56", "IDR", { currencyNative: true }))
      .toBe(formatFiatAmount("1234.56", "IDR", { regionId: "ID" }));
  });

  test("keeps every high-scale bigint digit in both presentation modes", () => {
    const atoms = BigInt("123456789012345678901234567890123456");
    for (const options of [{ regionId: "US" } as const, { currencyNative: true } as const]) {
      const formatted = formatFiatAmount(atoms, 18, "USD", {
        ...options, fractionDigits: 18, minimumFractionDigits: 18,
      });
      expect(formatted).toBe("$123,456,789,012,345,678.901234567890123456");
    }
  });

  test("requires a presentation choice in the type and at runtime", () => {
    const invalidPresentations = () => {
      // @ts-expect-error options are required
      formatFiatAmount("1", "USD");
      // @ts-expect-error an empty options object does not choose a region
      formatFiatAmount("1", "USD", {});
      // @ts-expect-error precision without a region is not presentation
      formatFiatAmount("1", "USD", { fractionDigits: 2 });
      // @ts-expect-error the two presentation modes are exclusive
      formatFiatAmount("1", "USD", { regionId: "US", currencyNative: true });
    };
    expect(invalidPresentations).toBeFunction();
    expect(() => formatFiatAmount("1", "USD", {} as { regionId: "US" }))
      .toThrow("A presentation region is required.");
    const untyped = formatFiatAmount as (...args: unknown[]) => string;
    expect(() => untyped("bad", "USD")).toThrow("A presentation region is required.");
    expect(() => untyped("bad", "USD", {})).toThrow("A presentation region is required.");
    expect(() => untyped("bad", "USD", null)).toThrow("A presentation region is required.");
    expect(() => untyped(BigInt(1), 2, "USD")).toThrow("A presentation region is required.");
  });

  test("rejects missing, mixed, and unknown modes in both runtime overloads", () => {
    const untyped = formatFiatAmount as (...args: unknown[]) => string;
    const formatters = [
      (options: unknown) => untyped("1.25", "USD", options),
      (options: unknown) => untyped(BigInt(125), 2, "USD", options),
    ];
    for (const format of formatters) {
      for (const options of [undefined, null, {}, { fractionDigits: 4 }, { currencyNative: false }]) {
        expect(() => format(options)).toThrow("A presentation region is required.");
      }
      for (const options of [
        { currencyNative: true, regionId: "US" },
        { currencyNative: true, regionId: undefined },
      ]) {
        expect(() => format(options)).toThrow("Choose exactly one fiat presentation mode.");
      }
      for (const regionId of ["ZZ", "toString", null, 1]) {
        expect(() => format({ regionId })).toThrow("Unknown presentation region.");
      }
    }
  });
});

describe("presentation money formatting", () => {
  test("presents atomic stablecoin amounts as fiat without rounding or changing the input", () => {
    const raw = "123456789999";
    const cases: Array<[AtomicAmount, number, string]> = [
      [raw, 6, "$123,456.78"],
      [BigInt(0), 6, "$0.00"],
      ["9999", 6, "<$0.01"],
      ["10000", 6, "$0.01"],
      [BigInt("123456789999000000000000"), 18, "$123,456.78"],
      ["-123456789999", 6, "−$123,456.78"],
      ["-9999", 6, "−<$0.01"],
    ];
    for (const [amount, decimals, expected] of cases) {
      expect(formatPresentationCashAmount(amount, decimals, "USD", { regionId: "US" }))
        .toBe(expected);
    }
    expect(raw).toBe("123456789999");
    expect(formatPresentationCashAmount(raw, 6, "USD", { regionId: "US" }))
      .toBe("$123,456.78");
    expect(formatPresentationCashAmount("01", 6, "USD")).toBe("—");
    expect(formatPresentationCashAmount("1", -1, "USD")).toBe("—");
  });

  test("uses the region currency formatter without converting currencies", () => {
    const formatted = formatPresentationCashAmount("1234567890", 6, "USD", { regionId: "BR" });
    expect(formatted).toBe(formatFiatAmount(BigInt(123456), 2, "USD", { regionId: "BR" }));
    expect(formatted).toContain("1.234,56");
    expect(formatPresentationCashAmount("1234567890", 6, "BRL", { regionId: "BR" }))
      .toBe(formatFiatAmount(BigInt(123456), 2, "BRL", { regionId: "BR" }));
  });

  test("keeps stable token digits and tiny thresholds when switching presentation", () => {
    const cases: Array<[AtomicAmount, number, "US" | "BR"]> = [
      ["123456789999", 6, "US"],
      ["0", 6, "US"],
      ["9999", 6, "US"],
      ["10000", 6, "US"],
      ["-9999", 6, "US"],
      [BigInt("123456789999000000000000"), 18, "US"],
      ["1", 0, "US"],
      ["15", 1, "BR"],
      ["123456789999", 6, "BR"],
    ];
    for (const [amount, decimals, regionId] of cases) {
      const token = formatPresentationTokenAmount(amount, decimals, "USDC", {
        cashCurrency: "USD", regionId,
      });
      const cash = formatPresentationCashAmount(amount, decimals, "USD", { regionId });
      expect(cash.startsWith("−")).toBe(token.startsWith("−"));
      expect(cash.includes("<")).toBe(token.includes("<"));
      expect(cash.replace(/\D/g, "")).toBe(token.replace(/\D/g, ""));
    }
  });

  test("keeps internal spaces in multi-word token labels", () => {
    expect(formatPresentationTokenAmount("999999", 18, "vault shares")).toBe("<0.000001 vault shares");
    expect(formatPresentationTokenAmount("1500000000000000000", 18, "vault shares", { useNoBreakSpace: true }))
      .toMatch(/^\S+\u00a0vault\u00a0shares$/);
  });

  test("returns localized quantity and digit-bearing symbol as separate parts", () => {
    expect(formatPresentationTokenAmountParts("5678", 0, "TOKEN1"))
      .toEqual({ amount: "5,678", symbol: "TOKEN1" });
    expect(formatPresentationTokenAmountParts("5678", 0, " 1INCH  "))
      .toEqual({ amount: "5,678", symbol: "1INCH" });
    expect(formatPresentationTokenAmountParts("1234567", 0, "TOKEN1", { regionId: "FR" }))
      .toEqual({ amount: "1\u202f234\u202f567", symbol: "TOKEN1" });
    expect(formatPresentationTokenAmountParts("1500000000000000000", 18, "vault  shares", { useNoBreakSpace: true }))
      .toEqual({ amount: "1.50", symbol: "vault\u00a0shares" });
    expect(formatPresentationTokenAmountParts("bad", 6, "USDC"))
      .toEqual({ amount: "—", symbol: "" });
  });

  test("multi-character currency symbols take one no-break space", () => {
    for (const formatted of [
      formatFiatAmount("1234.56", "BRL", { regionId: "BR", fractionDigits: 2 }),
      formatFiatAmount("1234.56", "IDR", { regionId: "ID", fractionDigits: 2 }),
    ]) {
      expect(formatted).toMatch(/^(?:R\$|Rp)\u00a0\S/);
      expect(formatted).not.toContain("\u00a0\u00a0");
    }
    expect(formatFiatAmount("1234.56", "USD", { regionId: "US", fractionDigits: 2 }))
      .toBe("$1,234.56");
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

  test("keeps cached number formatters isolated by locale, currency, and options", () => {
    const formatCases = [
      () => formatFiatAmount("1234.5", "USD", { regionId: "US", fractionDigits: 2 }),
      () => formatFiatAmount("1234.5", "ARS", { regionId: "AR", fractionDigits: 2 }),
      () => formatFiatAmount("1234.5", "IDR", { regionId: "ID", fractionDigits: 0 }),
      () => formatPresentationTokenAmount("1234500", 6, "USDC", {
        cashCurrency: "USD",
        regionId: "BR",
      }),
    ];
    const expected = ["$1,234.50", "$1.234,50", "Rp\u00A01.234", "1,23 USDC"];

    for (let pass = 0; pass < 3; pass += 1) {
      expect(formatCases.map((format) => format())).toEqual(expected);
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
    ).toBe("45,690,152.00 JESSE");
  });

  test("bounds token display by class, decimals, threshold, sign, and locale while exact review keeps precision", () => {
    const cases: Array<[string, number, string, string, "GLOBAL" | "DE" | "FR"]> = [
      ["1234567", 0, "ZORA", "1,234,567 ZORA", "GLOBAL"],
      ["999999", 6, "DEGEN", "0.999999 DEGEN", "GLOBAL"],
      ["1999999999999999999", 18, "ZORA", "1.99 ZORA", "GLOBAL"],
      ["-56780000000000000000", 18, "ZORA", "−56.78 ZORA", "GLOBAL"],
      ["5000000000000000000", 18, "ZORA", "5.00 ZORA", "GLOBAL"],
      ["420000000000000000", 18, "DEGEN", "0.42 DEGEN", "GLOBAL"],
      ["1000000", 6, "DEGEN", "1.00 DEGEN", "GLOBAL"],
      ["42", 8, "DEGEN", "<0.000001 DEGEN", "GLOBAL"],
      ["1234567890123456789012", 18, "ZORA", "1,234.56 ZORA", "GLOBAL"],
      ["123456789012345678901234567890", 18, "ZORA", "123,456,789,012.34 ZORA", "GLOBAL"],
      ["1500000000000000000", 18, "ETH", "1.5000 ETH", "GLOBAL"],
      ["999999", 8, "cbBTC", "0.009999 cbBTC", "GLOBAL"],
      ["1000000", 8, "cbBTC", "0.0100 cbBTC", "GLOBAL"],
      ["25000000", 6, "USDC", "25.00 USDC", "GLOBAL"],
      ["1", 6, "USDC", "<0.01 USDC", "GLOBAL"],
      ["0", 18, "ETH", "0 ETH", "GLOBAL"],
      ["0", 6, "USDC", "0.00 USDC", "GLOBAL"],
      ["0", 18, "ZORA", "0 ZORA", "GLOBAL"],
      ["-1500000000000000000", 18, "ETH", "−1,5000 ETH", "FR"],
      ["1500000000000000000", 18, "ETH", "1,5000 ETH", "DE"],
      ["1234567890123456789012", 18, "ZORA", "1.234,56 ZORA", "DE"],
    ];
    for (const [atoms, decimals, symbol, expected, regionId] of cases) {
      expect(formatPresentationTokenAmount(atoms, decimals, symbol, { regionId })).toBe(expected);
    }
    expect(formatExactPresentationTokenAmount("1234567890123456789012", 18, "ZORA"))
      .toBe("1,234.567890123456789012 ZORA");
    expect(formatExactPresentationTokenAmount("42", 8, "DEGEN"))
      .toBe("0.00000042 DEGEN");
  });

  test("centralizes exact token, fiat, WAD, basis-point, health, and oracle formatting", () => {
    const cases = [
      { actual: formatUnsignedTokenAmount("1234560000", 6), expected: "1,234.56" },
      { actual: formatExactPresentationTokenAmount("1", 18, "ETH", { useNoBreakSpace: true }), expected: "0.000000000000000001\u00A0ETH" },
      { actual: formatUsdStablecoinAmount("0"), expected: "$0.00" },
      { actual: formatUsdStablecoinAmount("1234560000"), expected: "$1,234.56" },
      { actual: formatUsdStablecoinAmount("1000001"), expected: "$1.000001" },
      { actual: formatUsdStablecoinAmount("not-raw"), expected: "—" },
      { actual: formatFiatAmount("1234.565", "USD", { currencyNative: true }), expected: "$1,234.56" },
      { actual: formatWadPercent("455000000000000"), expected: "0.05%" },
      { actual: formatBasisPoints("455"), expected: "4.55%" },
      { actual: formatBasisPoints("455", "DE"), expected: "4,55\u00a0%" },
      { actual: formatBasisPoints("455", "TR"), expected: "%4,55" },
      { actual: formatBasisPoints(BigInt(10) ** BigInt(313)), expected: "—" },
      { actual: formatHealthFactor("1235000000000000000"), expected: "1.24" },
      { actual: formatHealthFactor(null), expected: "No debt" },
      { actual: formatOracleUsd("800000000000000000000000000000000000000", { loanDecimals: 6, collateralDecimals: 8 }), expected: "$80,000.00" },
    ];
    for (const entry of cases) expect(entry.actual).toBe(entry.expected);

    expect(formatPresentationPercentage(0.041)).toBe("4.10%");
    expect(formatPresentationPercentage(null)).toBe("—");

    expect(formatPresentationTokenAmount("bad", 6, "USDC")).toBe("—");
    expect(formatFiatAmount("-1", "USD", { currencyNative: true })).toBe("—");
    expect(() => formatUnsignedTokenAmount("-1", 6)).toThrow(TypeError);
    expect(() => formatWadPercent("-1")).toThrow(TypeError);
    expect(() => formatBasisPoints("-1")).toThrow(TypeError);
    expect(() => formatWadFeePercent("-1")).toThrow(TypeError);
    expect(() => formatHealthFactor("-1")).toThrow(TypeError);
    expect(() => formatOracleUsd("-1", { loanDecimals: 6, collateralDecimals: 8 })).toThrow(TypeError);
  });

  test("formats WAD fees as locale-aware percents without hiding small fees", () => {
    const cases: Array<[string, "GLOBAL" | "DE" | "TR", string]> = [
      ["100000000000000000", "GLOBAL", "10.00%"],
      ["100000000000000000", "DE", "10,00\u00a0%"],
      ["100000000000000000", "TR", "%10,00"],
      ["40000000000000", "GLOBAL", "0.004%"],
      ["40000000000000", "DE", "0,004\u00a0%"],
      ["40000000000000", "TR", "%0,004"],
      ["123456789000000000", "GLOBAL", "12.345679%"],
      ["10000000000", "GLOBAL", "0.000001%"],
      ["1000000000000000000", "DE", "100,00\u00a0%"],
      ["0", "GLOBAL", "0%"],
      ["0", "DE", "0\u00a0%"],
      ["0", "TR", "%0"],
    ];
    for (const [raw, regionId, expected] of cases) expect(formatWadFeePercent(raw, regionId)).toBe(expected);
  });

  test("formats exact cash amounts in the currency's own decimals", () => {
    const cases: Array<[string, number, string, string]> = [
      ["0", 6, "USD", "$0.00"],
      ["1", 6, "USD", "$0.000001"],
      ["1000000", 6, "USD", "$1.00"],
      ["1234567", 6, "USD", "$1.234567"],
      ["1230000", 6, "USD", "$1.23"],
      ["1980123", 6, "EUR", "€1.980123"],
      ["1", 2, "EUR", "€0.01"],
      ["-1", 6, "USD", "—"],
      ["not-raw", 6, "USD", "—"],
    ];
    for (const [atoms, decimals, currency, expected] of cases) {
      expect(formatExactPresentationCashAmount(atoms, decimals, currency)).toBe(expected);
    }
  });

  test("keeps ordinary and tiny market prices exact within display bounds", () => {
    expect(formatPresentationPrice("231.708792875")).toBe("$231.71");
    expect(formatPresentationPrice("12345678901234567890.1")).toBe(
      "$12,345,678,901,234,567,890.10",
    );
    expect(formatPresentationPrice("0.000123456789")).toBe("$0.0001235");
    expect(formatPresentationPrice("1e-7")).toBe("$0.0000001");
    expect(formatPresentationPrice("0.000000001")).toBe("<$0.00000001");
    expect(formatPresentationPrice("231.708792875", "BRL", "BR")).toBe(
      "R$\u00A0231,71",
    );
    expect(formatChartPrice("0.0123456")).toBe("$0.012346");
    expect(formatChartPrice("1.234e-7")).toBe("$0.0000001234");
    expect(formatPresentationPrice("not-a-price")).toBeNull();
    expect(formatPresentationPrice(Number.POSITIVE_INFINITY)).toBeNull();
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
      positive: "var(--market-gain)",
      negative: "var(--market-loss)",
      neutral: "var(--muted-foreground)",
    });
  });

  test("formats quote expiry from the supplied instant with seconds and zone", () => {
    expect(formatPresentationDate("2026-09-10T12:04:30.000Z", {
      timeZone: "UTC",
      style: "quote-time",
    })).toBe("12:04:30 PM UTC");
    expect(formatPresentationDate("not-a-date", {
      timeZone: "UTC",
      style: "quote-time",
    })).toBe("—");
  });

  test("keeps repeated date formatting identical across locales, styles, instants, and zones", () => {
    const cases = [
      { regionId: "US", locale: "en-US", timeZone: "UTC", style: "activity-full", date: { month: "short", day: "numeric", year: "numeric" }, time: { hour: "numeric", minute: "2-digit" } },
      { regionId: "US", locale: "en-US", timeZone: "America/Los_Angeles", style: "activity-full", date: { month: "short", day: "numeric", year: "numeric" }, time: { hour: "numeric", minute: "2-digit" } },
      { regionId: "DE", locale: "de-DE", timeZone: "UTC", style: "activity-short", date: { month: "short", day: "numeric" }, time: { hour: "numeric", minute: "2-digit" } },
      { regionId: "US", locale: "en-US", timeZone: "UTC", style: "date-time-zone", date: { month: "short", day: "numeric", year: "numeric" }, time: { hour: "numeric", minute: "2-digit", timeZoneName: "short" } },
      { regionId: "US", locale: "en-US", timeZone: "UTC", style: "quote-time", date: null, time: { hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" } },
      { regionId: "DE", locale: "de-DE", timeZone: "America/Los_Angeles", style: "chart-weekday", date: { weekday: "short" }, time: null },
    ] as const;
    for (const instant of ["2026-09-10T12:04:30.000Z", "2026-12-10T00:01:20.000Z"]) {
      for (const entry of cases) {
        const expected = [entry.date, entry.time]
          .filter((part): part is NonNullable<typeof part> => part !== null)
          .map((part) => new Intl.DateTimeFormat(entry.locale, { ...part, timeZone: entry.timeZone })
            .format(new Date(instant)).replace(/[\s\u00A0\u2007\u2009\u202F]+/g, " ").trim())
          .join(", ");
        expect(formatPresentationDate(instant, entry)).toBe(expected);
        expect(formatPresentationDate(instant, entry)).toBe(expected);
      }
    }
  });

  test("formats a date range compactly and collapses a single day", () => {
    const options = { timeZone: "UTC", style: "activity-date" } as const;
    expect(formatPresentationDateRange("2026-09-21T05:00:00.000Z", "2026-09-24T05:00:00.000Z", options)).toBe("Sep 21 – 24");
    expect(formatPresentationDateRange("2026-08-30T05:00:00.000Z", "2026-09-02T05:00:00.000Z", options)).toBe("Aug 30 – Sep 2");
    expect(formatPresentationDateRange("2026-09-24T05:00:00.000Z", "2026-09-24T09:00:00.000Z", options)).toBe("Sep 24");
    expect(formatPresentationDateRange("2026-09-24T05:00:00.000Z", "not-a-date", options)).toBe("—");
  });

  test("returns a deterministic unavailable value for malformed dates", () => {
    expect(formatPresentationDate("not-a-date", {
      timeZone: "UTC",
      style: "activity-full",
    })).toBe("—");
  });

  test("formats presentation fiat through the shared formatting barrel", () => {
    expect(presentationCurrencyName("USD")).toBe("US dollar");
    expect(presentationCurrencyName("IDR")).toBe("Rupiah");
    expect(formatPresentationFiat({ atoms: "481240", scale: 2 }, "IDR", 2, "ID")).toBe(
      "Rp\u00A04.812,40",
    );
  });
});

describe("formatTrimmedChartPrice", () => {
  test("drops trailing compact zeros with the region's decimal separator", () => {
    expect(formatTrimmedChartPrice("382000000")).toBe("$382M");
    expect(formatTrimmedChartPrice("38200000", { regionId: "BR" })).toBe("$38,2\u00A0mi");
    expect(formatTrimmedChartPrice("2410000000000", { regionId: "ID" })).toBe("$2,41T");
    expect(formatTrimmedChartPrice("850")).toBe("$850.00");
  });
});
