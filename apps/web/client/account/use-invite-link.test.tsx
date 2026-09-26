import "@/client/account/dom-test-harness";

import { describe, expect, test } from "bun:test";
import { renderHook, waitFor } from "@testing-library/react";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { useInviteLink } from "./use-invite-link";

describe("useInviteLink", () => {
  for (const status of [403, 503]) {
    test(`treats ${status} as unavailable`, async () => {
      const fetchAccountResource: AccountWalletClient["fetchAccountResource"] = async () => {
        throw Object.assign(new Error("unavailable"), { status });
      };
      const hook = renderHook(() => useInviteLink({ ownerKey: `owner-${status}`, fetchAccountResource }));
      await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
      expect(hook.result.current.data).toBeNull();
    });
  }

  test("rejects a mismatched response version", async () => {
    const hook = renderHook(() => useInviteLink({
      ownerKey: "mismatch-owner",
      fetchAccountResource: async () => ({ version: 2, code: "abcdefghjk" }),
    }));
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(hook.result.current.data).toBeUndefined();
  });

  test("does not show a previous owner's link during an owner switch", async () => {
    const fetchAccountResource = async () => ({ version: 1, code: "abcdefghjk" });
    const hook = renderHook(({ ownerKey }: { ownerKey: string | null }) => useInviteLink({ ownerKey, fetchAccountResource }), {
      initialProps: { ownerKey: "first-owner" as string | null },
    });
    await waitFor(() => expect(hook.result.current.data).toBe(`${window.location.origin}/invite/abcdefghjk`));
    hook.rerender({ ownerKey: null });
    expect(hook.result.current.data).toBeUndefined();
  });
});
