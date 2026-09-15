import { describe, expect, test } from "bun:test";
import { filterSpeedInsightsEvent } from "./speed-insights";

const vital = { type: "vital" as const };

describe("Speed Insights route boundary", () => {
  test("normalizes url and route to the L1 label and strips query and hash state", () => {
    expect(filterSpeedInsightsEvent({
      ...vital,
      url: "https://home.example/?account=signin#secret",
      route: "/",
    })).toEqual({ ...vital, url: "https://home.example/", route: "/" });
    expect(filterSpeedInsightsEvent({
      ...vital,
      url: "https://home.example/balances/investments?flow=send#asset",
      route: "/balances/investments",
    })).toEqual({ ...vital, url: "https://home.example/balances", route: "/balances" });
    expect(filterSpeedInsightsEvent({
      ...vital,
      url: "https://alice:secret@home.example/invest/cbbtc#asset",
      route: "/invest/cbbtc",
    })).toEqual({ ...vital, url: "https://home.example/invest", route: "/invest" });
  });

  test("drops unobserved, legacy, relative, and malformed URLs", () => {
    expect(filterSpeedInsightsEvent({ ...vital, url: "https://home.example/dashboard?panel=balances" }))
      .toBeNull();
    expect(filterSpeedInsightsEvent({ ...vital, url: "https://home.example/dev/ui?token=secret" }))
      .toBeNull();
    expect(filterSpeedInsightsEvent({ ...vital, url: "/?token=secret" })).toBeNull();
    expect(filterSpeedInsightsEvent({ ...vital, url: "http://[" })).toBeNull();
  });
});
