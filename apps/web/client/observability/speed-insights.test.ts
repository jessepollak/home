import { describe, expect, test } from "bun:test";
import { filterSpeedInsightsEvent } from "./speed-insights";

const vital = { type: "vital" as const };

describe("Speed Insights route boundary", () => {
  test("keeps only product entry routes and strips query and hash state", () => {
    expect(filterSpeedInsightsEvent({
      ...vital,
      url: "https://home.example/?account=signin#secret",
      route: "/?account=signin",
    })).toEqual({ ...vital, url: "/", route: "/" });
    expect(filterSpeedInsightsEvent({
      ...vital,
      url: "https://home.example/dashboard?panel=balances#asset",
    })).toEqual({ ...vital, url: "/dashboard", route: "/dashboard" });
  });

  test("drops unobserved and malformed URLs", () => {
    expect(filterSpeedInsightsEvent({ ...vital, url: "/activity?token=secret" })).toBeNull();
    expect(filterSpeedInsightsEvent({ ...vital, url: "http://[" })).toBeNull();
  });
});
