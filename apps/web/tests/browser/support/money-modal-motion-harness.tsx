import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AccountWalletClientProvider,
  createBlockedAccountWalletClient,
  type AccountWalletClient,
} from "../../../features/account/cdp-client";
import { cryptoAssets } from "../../../config/invest-assets";
import { FundingExperienceForWallet } from "../../../features/funding/funding-experience";
import type { PreparedMoneyAction } from "../../../features/money-actions/types";
import { TradeActions } from "../../../features/trading/trade-actions";
import { TransferActionsForWallet } from "../../../features/transfers/transfer-actions";

const ADDRESS_A = "0x1111111111111111111111111111111111111111" as const;
const ADDRESS_B = "0x2222222222222222222222222222222222222222" as const;
const RECIPIENT = "0x3333333333333333333333333333333333333333" as const;
const HASH = `0x${"ab".repeat(32)}` as const;
const BITCOIN = cryptoAssets.find((asset) => asset.id === "cbbtc")!;

type Owner = "a" | "b" | "none";
type TransferWallet = Pick<
  AccountWalletClient,
  | "ownerKey"
  | "status"
  | "session"
  | "pendingTransfer"
  | "sendTransfer"
  | "checkPendingTransfer"
  | "startNewTransfer"
> & Partial<Pick<AccountWalletClient, "prepareMoneyAction" | "fetchAccountResource">>;

type MoneyModalHarnessControl = {
  setOwner: (owner: Owner) => void;
  setPendingPrepare: (pending: boolean) => void;
  openSend: () => void;
  addressA: typeof ADDRESS_A;
  recipient: typeof RECIPIENT;
};

declare global {
  interface Window {
    moneyModalHarness: MoneyModalHarnessControl;
  }
}

function pendingPromise<T>() {
  return new Promise<T>(() => {});
}

function accountClientFor(owner: Owner): AccountWalletClient {
  if (owner === "none") return createBlockedAccountWalletClient("unconfigured");
  const address = owner === "a" ? ADDRESS_A : ADDRESS_B;
  return {
    ...createBlockedAccountWalletClient("unconfigured"),
    projectConfigured: true,
    signInAvailability: "ready",
    isSignedIn: true,
    ownerKey: `owner-${owner}`,
    status: "verified",
    session: {
      user: { subject: `subject-${owner}` },
      smartAccount: { address, chainId: 8453 },
      accountProvider: "cdp-embedded",
    },
  };
}

function walletFor(owner: Owner, pendingPrepare: boolean): TransferWallet {
  if (owner === "none") {
    return {
      ownerKey: null,
      status: "signed-out",
      session: null,
      pendingTransfer: null,
      sendTransfer: async () => {
        throw new Error("signed out");
      },
      checkPendingTransfer: async () => {
        throw new Error("signed out");
      },
      startNewTransfer: () => {},
    };
  }
  const address = owner === "a" ? ADDRESS_A : ADDRESS_B;
  return {
    ownerKey: `owner-${owner}`,
    status: "verified",
    session: {
      user: { subject: `subject-${owner}` },
      smartAccount: { address, chainId: 8453 },
      accountProvider: "cdp-embedded",
    },
    pendingTransfer: null,
    sendTransfer: async (request) => ({ ...request, transactionHash: HASH }),
    checkPendingTransfer: async () => {
      throw new Error("No pending transfer");
    },
    startNewTransfer: () => {},
    ...(pendingPrepare
      ? {
          prepareMoneyAction: async () => pendingPromise<PreparedMoneyAction>(),
          fetchAccountResource: async () => ({ scope: "unresolved-send", operations: [] }),
        }
      : {}),
  };
}

function MoneyModalMotionHarness() {
  const [owner, setOwner] = useState<Owner>("a");
  const [pendingPrepare, setPendingPrepare] = useState(false);
  const [fundingOpen, setFundingOpen] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const accountClient = useMemo(() => accountClientFor(owner), [owner]);
  const wallet = useMemo(() => walletFor(owner, pendingPrepare), [owner, pendingPrepare]);

  useEffect(() => {
    window.moneyModalHarness = {
      setOwner,
      setPendingPrepare,
      openSend: () => Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])
        .find((button) => button.textContent === "Send")
        ?.click(),
      addressA: ADDRESS_A,
      recipient: RECIPIENT,
    };
  }, []);

  return (
    <main ref={rootRef} style={{ minHeight: 1200, padding: 16 }}>
      <p>Actual Trade, Send, Receive, and Add money consumers render below.</p>
      <button type="button" onClick={() => setFundingOpen(true)}>Add money</button>
      <AccountWalletClientProvider client={accountClient}>
        <TradeActions asset={BITCOIN} />
      </AccountWalletClientProvider>
      <FundingExperienceForWallet
        wallet={accountClient}
        navigateToHostedOnramp={() => {}}
        open={fundingOpen}
        onClose={() => setFundingOpen(false)}
      />
      <TransferActionsForWallet
        wallet={wallet}
        availableByAsset={{ usdc: "125.00", eth: "2.5" }}
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<MoneyModalMotionHarness />);
