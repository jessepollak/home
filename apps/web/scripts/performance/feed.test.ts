import { expect, test } from "bun:test";
import { fillFeed } from "./feed";
import { setCpuRate, type Session } from "./browser";

function fakeSession(requested: number, send = async (_method: string, _params: { rate: number }) => {}) {
  const rates: number[] = [];
  const session = {
    cpu: { requested, applied: requested },
    cdp: { send: async (method: string, params: { rate: number }) => { rates.push(params.rate); await send(method, params); } },
    page: { locator: (selector: string) => selector.startsWith("main") ? { evaluate: async () => {} } :
      { filter: () => ({ isVisible: async () => true }) } },
  } as unknown as Session;
  return { session, rates };
}

for (const rate of [1, 2.5, 4]) {
  test(`fillFeed restores requested ${rate}× rate`, async () => {
    const { session, rates } = fakeSession(rate);
    await fillFeed(session, 20, () => true);
    expect(rates).toEqual([1, rate]);
    expect(session.cpu).toEqual({ requested: rate, applied: rate });
  });
}

test("fillFeed restores the requested rate when filling fails", async () => {
  const { session, rates } = fakeSession(2.5);
  await expect(fillFeed(session, 20, () => { throw new Error("Fill failed"); })).rejects.toThrow("Fill failed");
  expect(rates).toEqual([1, 2.5]);
  expect(session.cpu.applied).toBe(2.5);
});

test("setCpuRate changes applied only after CDP accepts the rate", async () => {
  const { session } = fakeSession(4, async () => { throw new Error("CDP rejected"); });
  await expect(setCpuRate(session, 2)).rejects.toThrow("CDP rejected");
  expect(session.cpu.applied).toBe(4);
});

test("setCpuRate rejects invalid rates before CDP", async () => {
  const { session, rates } = fakeSession(4);
  for (const rate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
    await expect(setCpuRate(session, rate)).rejects.toThrow("Invalid CPU throttle rate");
  expect(rates).toEqual([]);
  expect(session.cpu.applied).toBe(4);
});
