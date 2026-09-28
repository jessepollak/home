import { describe, expect, test } from "bun:test";
import { sumsubLanguage } from "./sumsub-language";

describe("Sumsub language", () => {
  test("selects provider-supported Portuguese variants and falls back for Maltese", () => {
    expect(sumsubLanguage("pt-BR")).toBe("pt-br");
    expect(sumsubLanguage("pt-PT")).toBe("pt");
    expect(sumsubLanguage("pt")).toBe("pt");
    expect(sumsubLanguage("mt-MT")).toBe("en");
    expect(sumsubLanguage("xx-XX")).toBe("en");
    expect(sumsubLanguage("")).toBe("en");
    expect(sumsubLanguage("es-MX")).toBe("es");
    expect(sumsubLanguage("zh-Hant-TW")).toBe("zh-tw");
    expect(sumsubLanguage("zu-ZA")).toBe("zu");
  });
});
