import "@/client/account/dom-test-harness";
import { afterEach, expect, test } from "bun:test";
import { deferred } from "@/tests/helpers/async";
import { anonymousCountryPreferenceKey, anonymousDisplayCurrencyPreferenceKey } from "@/config/country-preference";
import { useHomeRegion } from "./use-home-region";

const { act, cleanup, renderHook, waitFor } = await import("@testing-library/react");
type Input = Parameters<typeof useHomeRegion>[0];
const signedOut: Input = { detectedCountry: "BR" };
const signedIn: Input = { detectedCountry: "BR", accountIdentity: "a", accountOwner: "owner-a", signedIn: true,
  accountReady: true, accountPreference: "BR", accountDisplayCurrency: "country-default" };
afterEach(() => { cleanup(); window.localStorage.clear(); });

test("an explicit USD survives country changes, including a matching country default", () => {
  const { result } = renderHook(() => useHomeRegion(signedOut));
  act(() => result.current.selectDisplayCurrency("USD"));
  act(() => result.current.selectRegion("US"));
  expect(result.current.displayCurrency).toEqual({ currency: "USD", source: "explicit", withdrawn: null });
  act(() => result.current.selectRegion("ID"));
  expect(result.current.displayCurrency.currency).toBe("USD");
  expect(window.localStorage.getItem(anonymousDisplayCurrencyPreferenceKey)).toBe("USD");
  act(() => result.current.selectDisplayCurrency("country-default"));
  expect(result.current.displayCurrency.currency).toBe("IDR");
  expect(window.localStorage.getItem(anonymousDisplayCurrencyPreferenceKey)).toBeNull();
  act(() => result.current.selectRegion("BR"));
  expect(result.current.displayCurrency).toEqual({ currency: "BRL", source: "country-default", withdrawn: null });
});

test("failed account saves retain the latest visit choice and retry it", async () => {
  const writes: string[] = [];
  let fail = true;
  const { result } = renderHook(() => useHomeRegion({ ...signedIn, writeAccountDisplayCurrency: async (choice) => {
    writes.push(choice);
    if (fail) throw new Error("offline");
    return choice;
  } }));
  act(() => result.current.selectDisplayCurrency("USD"));
  await waitFor(() => expect(result.current.displayCurrencyWriteFailed).toBe(true));
  expect(result.current.displayCurrency.currency).toBe("USD");
  expect(result.current.displayCurrencyMessage).toBe("Display currency changed for this visit only. Could not save to your account.");
  fail = false;
  act(() => result.current.retryDisplayCurrencyWrite());
  await waitFor(() => expect(result.current.displayCurrencyMessage).toBe("Display currency saved to your account."));
  expect(writes).toEqual(["USD", "USD"]);
});

test("blocked browser storage never reports a saved preference", () => {
  const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", { configurable: true, get: () => { throw new Error("blocked"); } });
  try {
    const { result } = renderHook(() => useHomeRegion(signedOut));
    act(() => result.current.selectDisplayCurrency("USD"));
    expect(result.current.displayCurrency.currency).toBe("USD");
    expect(result.current.displayCurrencyWriteFailed).toBe(true);
    expect(result.current.displayCurrencyMessage).toBe("Display currency changed for this visit. Browser storage is unavailable.");
  } finally {
    if (descriptor) Object.defineProperty(window, "localStorage", descriptor);
    else Reflect.deleteProperty(window, "localStorage");
  }
});

test("a delayed write cannot change another account, even after an A-B-A switch", async () => {
  const pending = deferred<string | null>();
  const writer = () => pending.promise;
  const { result, rerender } = renderHook((input: Input) => useHomeRegion(input), { initialProps: { ...signedIn, writeAccountDisplayCurrency: writer } });
  act(() => result.current.selectDisplayCurrency("USD"));
  rerender({ ...signedIn, accountIdentity: "b", accountOwner: "owner-b", accountDisplayCurrency: "EUR", writeAccountDisplayCurrency: writer });
  expect(result.current.displayCurrency.currency).toBe("EUR");
  rerender({ ...signedIn, accountDisplayCurrency: "BRL", writeAccountDisplayCurrency: writer });
  await act(async () => { pending.resolve("USD"); await pending.promise; });
  expect(result.current.displayCurrency.currency).toBe("BRL");
  expect(result.current.displayCurrencyMessage).toBe("");
});

test.each(["country-default", "EUR", "ZZZ"])("a saved account choice %s wins over this browser", async (stored) => {
  window.localStorage.setItem(anonymousDisplayCurrencyPreferenceKey, "USD");
  let writes = 0;
  const { result } = renderHook(() => useHomeRegion({ ...signedIn, accountDisplayCurrency: stored,
    writeAccountDisplayCurrency: async () => { writes += 1; return "USD"; } }));
  expect(result.current.displayCurrency.currency).toBe(stored === "EUR" ? "EUR" : "BRL");
  expect(result.current.displayCurrency.withdrawn).toBe(stored === "ZZZ" ? "ZZZ" : null);
  expect(writes).toBe(0);
});

test("browser adoption applies the concurrent account winner without touching country", async () => {
  window.localStorage.setItem(anonymousDisplayCurrencyPreferenceKey, "USD");
  const writes: Array<{ choice: string; adopt: boolean }> = [];
  const { result } = renderHook(() => useHomeRegion({ ...signedIn, accountDisplayCurrency: null,
    writeAccountDisplayCurrency: async (choice, adopt) => { writes.push({ choice, adopt }); return "country-default"; },
    writeAccountPreference: async () => { throw new Error("Must not update country"); } }));
  await waitFor(() => expect(result.current.displayCurrency.currency).toBe("BRL"));
  expect(result.current.displayCurrency.source).toBe("country-default");
  expect(writes).toEqual([{ choice: "USD", adopt: true }]);
});

test("a failed adoption retry still cannot overwrite a concurrent saved choice", async () => {
  window.localStorage.setItem(anonymousDisplayCurrencyPreferenceKey, "USD");
  const writes: boolean[] = [];
  const { result } = renderHook(() => useHomeRegion({ ...signedIn, accountDisplayCurrency: null,
    writeAccountDisplayCurrency: async (_choice, adopt) => {
      writes.push(adopt);
      if (writes.length === 1) throw new Error("offline");
      return "EUR";
    } }));
  await waitFor(() => expect(result.current.displayCurrencyWriteFailed).toBe(true));
  act(() => result.current.retryDisplayCurrencyWrite());
  await waitFor(() => expect(result.current.displayCurrency.currency).toBe("EUR"));
  expect(writes).toEqual([true, true]);
});

test("a selection while settling is held until the same owner is verified", async () => {
  const writes: string[] = [];
  const writer = async (choice: string) => { writes.push(choice); return choice; };
  const initialProps: Input = { detectedCountry: "BR", accountSettling: true, writeAccountDisplayCurrency: writer };
  const { result, rerender } = renderHook((input: Input) => useHomeRegion(input), { initialProps });
  act(() => result.current.selectDisplayCurrency("USD"));
  expect(writes).toEqual([]);
  expect(window.localStorage.getItem(anonymousDisplayCurrencyPreferenceKey)).toBeNull();
  rerender({ ...signedIn, accountSettling: true, accountReady: false, accountPreferencePending: true, writeAccountDisplayCurrency: writer });
  expect(result.current.isPreferenceReady).toBe(false);
  expect(writes).toEqual([]);
  rerender({ ...signedIn, writeAccountDisplayCurrency: writer });
  await waitFor(() => expect(result.current.displayCurrencyMessage).toBe("Display currency saved to your account."));
  expect(writes).toEqual(["USD"]);
});

test("country and currency saves share one ordered queue and remain independent", async () => {
  const pending = deferred<"US">();
  const { result } = renderHook(() => useHomeRegion({ ...signedIn,
    writeAccountPreference: () => pending.promise,
    writeAccountDisplayCurrency: async () => "EUR",
  }));
  act(() => result.current.selectRegion("US"));
  act(() => result.current.selectDisplayCurrency("EUR"));
  expect(result.current.displayCurrency.currency).toBe("EUR");
  await act(async () => { pending.resolve("US"); await pending.promise; });
  await waitFor(() => expect(result.current.displayCurrencyMessage).toBe("Display currency saved to your account."));
  expect(result.current.regionId).toBe("US");
  expect(result.current.displayCurrency.source).toBe("explicit");
});

test("a queued country adoption cannot dispatch under another account after a currency write settles", async () => {
  window.localStorage.setItem(anonymousCountryPreferenceKey, "US");
  const pending = deferred<string | null>();
  const writes: Array<{ identity: string; country: string }> = [];
  let identity = "a";
  const writers: Pick<Input, "writeAccountPreference" | "writeAccountDisplayCurrency"> = {
    writeAccountDisplayCurrency: () => pending.promise,
    writeAccountPreference: async (country) => { writes.push({ identity, country }); return country; },
  };
  const { result, rerender } = renderHook((input: Input) => useHomeRegion(input), {
    initialProps: { ...signedIn, ...writers },
  });
  act(() => result.current.selectDisplayCurrency("USD"));
  rerender({ ...signedIn, ...writers, accountPreference: null });
  expect(result.current.regionId).toBe("US");
  expect(writes).toEqual([]);
  identity = "b";
  rerender({ ...signedIn, ...writers, accountIdentity: "b", accountOwner: "owner-b" });
  await act(async () => { pending.resolve("USD"); await pending.promise; });
  expect(writes).toEqual([]);
  expect(result.current.regionId).toBe("BR");
});

test("returning to an account orders its new currency PUT after its earlier PUT", async () => {
  const pending = deferred<string | null>();
  const completed: string[] = [];
  const writer = async (choice: string) => {
    if (choice === "USD") await pending.promise;
    completed.push(choice);
    return choice;
  };
  const { result, rerender } = renderHook((input: Input) => useHomeRegion(input), {
    initialProps: { ...signedIn, writeAccountDisplayCurrency: writer },
  });
  act(() => result.current.selectDisplayCurrency("USD"));
  rerender({ ...signedIn, accountIdentity: "b", accountOwner: "owner-b", writeAccountDisplayCurrency: writer });
  act(() => result.current.selectDisplayCurrency("GBP"));
  await waitFor(() => expect(completed).toEqual(["GBP"]));
  rerender({ ...signedIn, writeAccountDisplayCurrency: writer });
  act(() => result.current.selectDisplayCurrency("EUR"));
  expect(completed).toEqual(["GBP"]);
  await act(async () => { pending.resolve("USD"); await pending.promise; });
  await waitFor(() => expect(completed).toEqual(["GBP", "USD", "EUR"]));
  expect(result.current.displayCurrency.currency).toBe("EUR");
  expect(result.current.displayCurrencyMessage).toBe("Display currency saved to your account.");
});
