import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ActivityRow } from "../../../components/finance-rows";
import { PrimaryNavigation } from "../../../components/primary-navigation";
import {
  MoneyModal,
  MoneyModalFooter,
  MoneyModalHeader,
} from "../../../features/money-modal";
import "../../../app/globals.css";

type View = "home" | "activity" | "invest" | "account";

type ShellHarnessControl = {
  closeForAccountBoundary: () => void;
};

declare global {
  interface Window {
    shellHarness: ShellHarnessControl;
  }
}

const activityRows = Array.from({ length: 18 }, (_, index) => index + 1);

function HomeShellHarness() {
  const [view, setView] = useState<View>("home");
  const [modalOpen, setModalOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  function navigate(next: View) {
    setView(next);
    mainRef.current?.scrollTo({ top: 0 });
  }

  useEffect(() => {
    window.shellHarness = {
      closeForAccountBoundary: () => {
        setModalOpen(false);
        navigate("account");
      },
    };
  });

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
              {view === "account" ? "Account" : view === "invest" ? "Invest" : "Home"}
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

      <main ref={mainRef} className="app-main app-main-authenticated" data-testid="shell-scroll">
        <section className="panel-stage" aria-label={`${view} panel`}>
          {view === "activity" ? (
            <ol aria-label="Activity rows" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {activityRows.map((row) => (
                <ActivityRow
                  key={row}
                  icon="↓"
                  iconTone="incoming"
                  label={`Activity item ${row}`}
                  context={`September ${row}`}
                  value={`+$${row}.00`}
                  valueTone="accent"
                />
              ))}
            </ol>
          ) : view === "home" ? (
            <div className="home-panel">
              <section className="balance-panel">
                <h2>Balance</h2>
                <button type="button" onClick={() => navigate("activity")}>
                  Open Activity
                </button>
                <button type="button" onClick={() => setModalOpen(true)}>
                  Open money modal
                </button>
              </section>
            </div>
          ) : (
            <section className="empty-panel">{view === "account" ? "Account settings" : "Investments"}</section>
          )}
        </section>
      </main>

      <PrimaryNavigation
        activeNavigation={view === "invest" ? "invest" : "home"}
        onNavigate={(id) => navigate(id)}
      />

      <MoneyModal
        open={modalOpen}
        labelledBy="shell-money-title"
        onCancel={() => setModalOpen(false)}
        onClose={() => setModalOpen(false)}
      >
        <MoneyModalHeader
          title="Add money"
          titleId="shell-money-title"
          onClose={() => setModalOpen(false)}
          closeLabel="Close money modal"
        />
        <div style={{ padding: 16 }}>Shared MoneyModal body</div>
        <MoneyModalFooter primaryLabel="Continue" onPrimary={() => {}} />
      </MoneyModal>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<HomeShellHarness />);
