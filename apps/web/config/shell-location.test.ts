import { describe, expect, test } from "bun:test";
import {
  parseShellLocation,
  shellHref,
} from "./shell-location";

describe("shell location", () => {
  test("treats a bare dashboard path as Home with no overlays", () => {
    expect(parseShellLocation(new URLSearchParams())).toEqual({
      panel: "home",
      account: null,
      shelf: null,
      asset: null,
    });
    expect(shellHref("/dashboard")).toBe("/dashboard");
  });

  test("encodes Save, Invest stacks, and Account settings as search params", () => {
    expect(shellHref("/dashboard", { panel: "save" })).toBe(
      "/dashboard?panel=save",
    );
    expect(shellHref("/dashboard", { panel: "invest", shelf: "crypto" })).toBe(
      "/dashboard?panel=invest&shelf=crypto",
    );
    expect(
      shellHref("/dashboard", {
        panel: "invest",
        asset: "cbbtc",
        shelf: "crypto",
      }),
    ).toBe("/dashboard?panel=invest&shelf=crypto&asset=cbbtc");
    expect(shellHref("/dashboard", { account: "settings" })).toBe(
      "/dashboard?account=settings",
    );
    expect(shellHref("/", { account: "signin" })).toBe("/?account=signin");
  });

  test("ignores invest params unless the panel is Invest", () => {
    expect(
      parseShellLocation({
        panel: "save",
        shelf: "crypto",
        asset: "cbbtc",
      }),
    ).toEqual({
      panel: "save",
      account: null,
      shelf: null,
      asset: null,
    });
  });

  test("drops unknown panel and account values", () => {
    expect(parseShellLocation({ panel: "explore", account: "profile" })).toEqual({
      panel: "home",
      account: null,
      shelf: null,
      asset: null,
    });
  });
});
