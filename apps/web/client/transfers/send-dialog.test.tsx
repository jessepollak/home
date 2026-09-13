import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { afterEach, describe, expect, test } from "bun:test";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { encodeUsdcTransfer } from "@/shared/transfers/transfer-helpers";
import { TransferExecutionError } from "@/shared/transfers/types";

const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { SendDialog } = await import("./send-dialog");

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const RECIPIENT = "0x2222222222222222222222222222222222222222" as const;
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const ACTION_ID = "11111111-1111-4111-8111-111111111111";

function resumedAction(kind: PreparedMoneyAction["kind"] = "send"): PreparedMoneyAction {
  return {
    id: ACTION_ID,
    kind,
    title: "Send USDC",
    createdAt: "2026-09-12T12:00:00.000Z",
    expiresAt: "2026-09-12T12:10:00.000Z",
    calls: [{ to: TOKEN, data: encodeUsdcTransfer(RECIPIENT, BigInt(1_000_000)), value: "0" }],
    amounts: [{
      assetId: "usdc",
      symbol: "USDC",
      decimals: 6,
      amountBaseUnits: "1000000",
      direction: "spend",
    }],
    warnings: [],
    owner: {
      subject: "subject-a",
      address: ACCOUNT,
      chainId: 8453,
      accountProvider: "cdp-embedded",
    },
  };
}

afterEach(cleanup);

describe("SendDialog resume", () => {
  test("resumes only a send action and decodes its recipient from server-authored calldata", async () => {
    let invalidResumes = 0;
    const view = render(
      <SendDialog
        open
        immediate
        address={ACCOUNT}
        ownerBoundary="owner-a"
        resumeActionId={ACTION_ID}
        prepareMoneyAction={async () => resumedAction()}
        resumeMoneyAction={async () => resumedAction()}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })}
        onInvalidResume={() => { invalidResumes += 1; }}
        onClose={() => {}}
      />,
    );

    expect(await page().findByRole("button", { name: "Send $1.00" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Copy 0x2222…222222" })).toBeTruthy();
    expect(invalidResumes).toBe(0);

    view.rerender(
      <SendDialog
        open
        immediate
        address={ACCOUNT}
        ownerBoundary="owner-a"
        resumeActionId="22222222-2222-4222-8222-222222222222"
        prepareMoneyAction={async () => resumedAction()}
        resumeMoneyAction={async () => resumedAction("savings-deposit")}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })}
        onInvalidResume={() => { invalidResumes += 1; }}
        onClose={() => {}}
      />,
    );

    expect(await page().findByRole("button", { name: "Continue" })).toBeTruthy();
    expect(invalidResumes).toBe(1);
  });

  test("returns to the first step when confirm reports an unavailable review", async () => {
    for (const status of [404, 410]) {
      let invalidResumes = 0;
      render(
        <SendDialog
          open
          immediate
          address={ACCOUNT}
          ownerBoundary={`owner-${status}`}
          resumeActionId={ACTION_ID}
          prepareMoneyAction={async () => resumedAction()}
          resumeMoneyAction={async () => resumedAction()}
          executeMoneyAction={async () => {
            throw Object.assign(new TransferExecutionError("unavailable"), { status });
          }}
          onInvalidResume={() => { invalidResumes += 1; }}
          onClose={() => {}}
        />,
      );

      fireEvent.click(await page().findByRole("button", { name: "Send $1.00" }));
      expect((await page().findByRole("alert")).textContent).toBe(
        "This review is no longer available — start again.",
      );
      expect(page().getByRole("button", { name: "Continue" })).toBeTruthy();
      expect(invalidResumes).toBe(1);
      cleanup();
    }
  });
});
