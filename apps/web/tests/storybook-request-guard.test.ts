import { describe, expect, test } from "bun:test";
import {
  isStorybookRuntimeRequest,
  isVercelToolbarRequest,
  rejectUnexpectedStoryRequest,
} from "../.storybook/request-guard";

const ORIGIN = "http://127.0.0.1:6006";

describe("Storybook unexpected-request guard", () => {
  test("allows only known same-origin Storybook runtime and production static paths", () => {
    expect(isStorybookRuntimeRequest(new Request(`${ORIGIN}/@vite/client`), ORIGIN)).toBeTrue();
    expect(isStorybookRuntimeRequest(new Request(`${ORIGIN}/assets/iframe.js`), ORIGIN)).toBeTrue();
    expect(isStorybookRuntimeRequest(new Request(`${ORIGIN}/mockServiceWorker.js`), ORIGIN)).toBeTrue();
    expect(isStorybookRuntimeRequest(new Request(`${ORIGIN}/client/activity/activity-ledger-sheet.tsx`), ORIGIN)).toBeTrue();
    expect(isStorybookRuntimeRequest(new Request(`${ORIGIN}/client/savings/savings-actions.tsx?t=1`), ORIGIN)).toBeTrue();
    expect(isStorybookRuntimeRequest(new Request(`${ORIGIN}/client/savings/savings-actions.tsx`, { method: "POST" }), ORIGIN)).toBeFalse();
    for (const path of ["/currency-flags/us.svg", "/home-mark/Doto.ttf", "/network-marks/base.svg"]) {
      expect(isStorybookRuntimeRequest(new Request(`${ORIGIN}${path}`), ORIGIN)).toBeTrue();
      expect(isStorybookRuntimeRequest(new Request(`${ORIGIN}${path}`, { method: "HEAD" }), ORIGIN)).toBeTrue();
    }
  });

  test("fails visibly for unexpected component, API, and external requests", () => {
    for (const request of [
      new Request(`${ORIGIN}/api/balances`),
      new Request(`${ORIGIN}/component-data.json`),
      new Request("https://provider.example.invalid/live"),
    ]) {
      expect(() => rejectUnexpectedStoryRequest(request, ORIGIN)).toThrow(
        `[Storybook request guard] Unexpected GET request to ${request.url}`,
      );
    }
  });
  test("lets the preview comments toolbar reach Vercel without opening other live origins", () => {
    expect(isVercelToolbarRequest(new Request("https://vercel.live/api/comments", { method: "POST" }), ORIGIN)).toBeTrue();
    expect(isVercelToolbarRequest(new Request("https://api.vercel.com/v1/me"), ORIGIN)).toBeTrue();
    expect(isVercelToolbarRequest(new Request("https://sockjs-us3.pusher.com/pusher/app/x"), ORIGIN)).toBeTrue();
    expect(isVercelToolbarRequest(new Request(`${ORIGIN}/.well-known/vercel/jwe`), ORIGIN)).toBeTrue();
    expect(isVercelToolbarRequest(new Request("https://notvercel.live.example.com/x"), ORIGIN)).toBeFalse();
    expect(isVercelToolbarRequest(new Request("http://vercel.live/x"), ORIGIN)).toBeFalse();
    expect(isVercelToolbarRequest(new Request(`${ORIGIN}/api/balances`), ORIGIN)).toBeFalse();
    expect(() => rejectUnexpectedStoryRequest(new Request("https://vercel.live/_next-live/feedback/instrument.js"), ORIGIN)).not.toThrow();
    expect(() => rejectUnexpectedStoryRequest(new Request("https://api.example.com/x"), ORIGIN)).toThrow();
  });
});
