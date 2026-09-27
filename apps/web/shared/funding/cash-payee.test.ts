import { describe, expect, test } from "bun:test";
import { cashPayeeLabels } from "./cash-payee";

describe("cashPayeeLabels", () => {
  test.each([
    ["cashapp", "Cash App", "Cash App cashtag", "Cashtag"],
    ["zelle", "Zelle", "Zelle email or phone", "Email or phone"],
    ["revolut", "Revolut", "Revolut Revtag", "Revtag"],
    ["monzo", "Monzo", "Monzo username", "Username"],
    ["other", "Other", "Other handle", "Handle"],
  ])("labels %s destinations", (platform, label, field, noun) => {
    expect(cashPayeeLabels(platform, label)).toEqual({ field, noun });
  });
});
