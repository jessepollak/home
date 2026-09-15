import { describe, expect, test } from "bun:test";
import { filterSpeedInsightsEvent } from "./speed-insights";

const vital = { type: "vital" as const };

describe("Speed Insights route boundary", () => {
  test("keeps only product entry routes and strips query and hash state", () => {
    expect(filterSpeedInsightsEvent({
      ...vital,
      url: "https://home.example/?account=signin#secret",
      route: "/",
    })).toEqual({ ...vital, url: "https://home.example/", route: "/" });
    expect(filterSpeedInsightsEvent({
      ...vital,
      url: "https://home.example/dashboard?panel=balances#asset",
      route: "/dashboard",
    })).toEqual({ ...vital, url: "https://home.example/dashboard", route: "/dashboard" });
    expect(filterSpeedInsightsEvent({
      ...vital,
      url: "https://alice:secret@home.example/dashboard?panel=balances#asset",
      route: "/dashboard",
    })).toEqual({ ...vital, url: "https://home.example/dashboard", route: "/dashboard" });
  });

  test("drops unobserved, relative, and malformed URLs", () => {
    expect(filterSpeedInsightsEvent({ ...vital, url: "https://home.example/activity?token=secret" }))
      .toBeNull();
    expect(filterSpeedInsightsEvent({ ...vital, url: "/?token=secret" })).toBeNull();
    expect(filterSpeedInsightsEvent({ ...vital, url: "http://[" })).toBeNull();
  });
});
