import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ActivityPanel, type FetchActivity } from "../../../features/activity";
import type { VerifiedAccountSession } from "../../../features/account/session-types";
import {
  MoneyModal,
  MoneyModalFooter,
  MoneyModalHeader,
} from "../../../features/money-modal";
import { PrimaryNavigation } from "../../../components/primary-navigation";
import type { ActivityPage, ActivityTransfer } from "../../../features/activity/types";
import "../../../app/globals.css";

type View = "home" | "activity" | "account";
type Owner = "a" | "b";
type RequestRecord = { owner: Owner; cursor: string | null; to: string; aborted: boolean };

type ActivityHarnessControl = {
  requests: () => RequestRecord[];
  switchAccount: () => void;
};

declare global {
  interface Window {
    activityHarness: ActivityHarnessControl;
  }
}

const WALLETS = {
  a: "0x1111111111111111111111111111111111111111",
  b: "0x2222222222222222222222222222222222222222",
} as const;
const OTHER = "0x3333333333333333333333333333333333333333" as const;

function ActivityPaginationHarness() {
  const [view, setView] = useState<View>("home");
  const [owner, setOwner] = useState<Owner>("a");
  const [modalOpen, setModalOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const failedLaterPage = useRef(false);
  const requests = useRef<RequestRecord[]>([]);

  const navigate = useCallback((next: View) => {
    setView(next);
    mainRef.current?.scrollTo({ top: 0 });
  }, []);

  const fetchActivity = useCallback<FetchActivity>(async (query, signal) => {
    const parameters = new URLSearchParams(query);
    const cursor = parameters.get("cursor");
    const record: RequestRecord = {
      owner,
      cursor,
      to: parameters.get("to")!,
      aborted: false,
    };
    requests.current.push(record);
    signal?.addEventListener("abort", () => {
      record.aborted = true;
    }, { once: true });

    if (!cursor) {
      return activityPage(query, owner, range(60, 49), "page-2");
    }
    if (cursor === "page-2") {
      await wait(450);
      if (owner === "a" && !failedLaterPage.current) {
        failedLaterPage.current = true;
        throw new Error("Synthetic later-page outage");
      }
      return activityPage(query, owner, range(48, 37), "page-3");
    }
    if (cursor === "page-3") {
      await wait(300);
      return activityPage(query, owner, range(36, 33), null);
    }
    throw new Error("Unexpected cursor");
  }, [owner]);

  useEffect(() => {
    window.activityHarness = {
      requests: () => requests.current.map((request) => ({ ...request })),
      switchAccount: () => setOwner((current) => current === "a" ? "b" : "a"),
    };
  });

  const currentSession = session(owner);

  return (
    <div className="app-frame app-frame-shell">
      <header className="app-header">
        <div className="app-header-start">
          {view === "activity" ? (
            <div className="header-leading">
              <button
                className="header-back-link"
                type="button"
                aria-label="Back"
                onClick={() => navigate("home")}
              >
                <span aria-hidden="true">←</span>
              </button>
              <h1 className="header-panel-title app-header-title">Activity</h1>
            </div>
          ) : (
            <h1 className="app-header-lead-title">
              {view === "account" ? "Account" : "Home"}
            </h1>
          )}
        </div>
        <span className="app-header-title-slot" aria-hidden="true" />
        <div className="app-header-end">
          {view === "account" ? (
            <button className="header-done-link" type="button" onClick={() => navigate("home")}>
              Done
            </button>
          ) : (
            <button
              className="header-account-link header-account-quiet"
              type="button"
              onClick={() => navigate("account")}
            >
              Account
            </button>
          )}
        </div>
      </header>

      <main ref={mainRef} className="app-main app-main-authenticated" data-testid="activity-scroll-root">
        <section className="panel-stage" aria-label={`${view} panel`}>
          {view === "activity" ? (
            <div className="activity-panel activity-panel-slot nested-home-panel" data-owner={owner}>
              <ActivityPanel
                session={currentSession}
                fetchActivity={fetchActivity}
                density="page"
                header={null}
              />
            </div>
          ) : view === "home" ? (
            <div className="home-panel">
              <section className="balance-panel">
                <h2>Balance</h2>
                <button type="button" onClick={() => setModalOpen(true)}>
                  Open money modal
                </button>
              </section>
              <div className="activity-panel activity-panel-slot">
                <ActivityPanel
                  session={currentSession}
                  fetchActivity={fetchActivity}
                  density="teaser"
                  header={(
                    <div>
                      <h2 id="activity-title">Activity</h2>
                      <button type="button" onClick={() => navigate("activity")}>
                        Open Activity
                      </button>
                    </div>
                  )}
                />
              </div>
            </div>
          ) : (
            <section className="empty-panel">
              <p>Active owner {owner.toUpperCase()}</p>
              <button type="button" onClick={() => setOwner((current) => current === "a" ? "b" : "a")}>
                Switch account
              </button>
            </section>
          )}
        </section>
      </main>

      <PrimaryNavigation
        activeNavigation="home"
        onNavigate={(id) => navigate(id === "home" ? "home" : "home")}
      />

      <MoneyModal
        open={modalOpen}
        labelledBy="activity-money-title"
        onCancel={() => setModalOpen(false)}
        onClose={() => setModalOpen(false)}
      >
        <MoneyModalHeader
          title="Add money"
          titleId="activity-money-title"
          onClose={() => setModalOpen(false)}
          closeLabel="Close money modal"
        />
        <div style={{ padding: 16 }}>Shared MoneyModal body</div>
        <MoneyModalFooter primaryLabel="Continue" onPrimary={() => {}} />
      </MoneyModal>
    </div>
  );
}

function session(owner: Owner): VerifiedAccountSession {
  return {
    user: { subject: `subject-${owner}` },
    smartAccount: { address: WALLETS[owner], chainId: 8453 },
    accountProvider: "cdp-embedded",
  };
}

function activityPage(
  query: string,
  owner: Owner,
  blockNumbers: number[],
  nextCursor: string | null,
): ActivityPage {
  const to = new URLSearchParams(query).get("to")!;
  return {
    walletAddress: WALLETS[owner],
    chainId: 8453,
    window: {
      from: new Date(new Date(to).getTime() - 31 * 24 * 60 * 60 * 1000).toISOString(),
      to,
    },
    transfers: blockNumbers.map((blockNumber) => transfer(to, owner, blockNumber)),
    nextCursor,
    source: {
      provider: "cdp-sql",
      cached: false,
      stale: false,
      executionTimestamp: new Date(new Date(to).getTime() - 1000).toISOString(),
      executionTimeMs: 1,
      fetchedAt: to,
    },
  };
}

function transfer(to: string, owner: Owner, blockNumber: number): ActivityTransfer {
  const hex = blockNumber.toString(16).padStart(64, "0");
  return {
    id: `${owner}-activity-${blockNumber}`,
    chainId: 8453,
    assetId: "usdc",
    tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    walletAddress: WALLETS[owner],
    fromAddress: OTHER,
    toAddress: WALLETS[owner],
    direction: "incoming",
    amountBaseUnits: `${blockNumber}000000`,
    blockNumber: String(blockNumber),
    blockHash: `0x${hex}`,
    transactionHash: `0x${hex}`,
    logIndex: "1",
    blockTimestamp: new Date(new Date(to).getTime() - (1000 - blockNumber) * 60_000).toISOString(),
  };
}

function range(from: number, to: number): number[] {
  return Array.from({ length: from - to + 1 }, (_, index) => from - index);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

createRoot(document.getElementById("root")!).render(<ActivityPaginationHarness />);
