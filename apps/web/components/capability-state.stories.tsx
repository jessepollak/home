import { useEffect, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { Card, CardContent } from "@/components/ui/card";
import {
  CapabilityState,
  capabilityStateKinds,
  type CapabilityStateAction,
  type CapabilityStateKind,
  type CapabilityStatePlacement,
} from "./capability-state";

const actions = {
  available: { kind: "open", onSelect: () => {} },
  "sign-in-required": { kind: "sign-in", onSelect: () => {} },
  "verification-start": { kind: "start-verification", onSelect: () => {} },
  "verification-pending": { kind: "resume-verification", onSelect: () => {} },
  "verification-rejected": { kind: "retry-verification", onSelect: () => {} },
  "unavailable-in-country": undefined,
  "not-yet-in-home": undefined,
  "temporarily-unavailable": { kind: "retry", onSelect: () => {} },
  "configuration-unavailable": undefined,
} satisfies Record<CapabilityStateKind, CapabilityStateAction | undefined>;

const capabilityNames = {
  available: "Save",
  "sign-in-required": "Buy investments",
  "verification-start": "Add money",
  "verification-pending": "Cash out",
  "verification-rejected": "Card",
  "unavailable-in-country": "Local transfers",
  "not-yet-in-home": "Local-currency savings",
  "temporarily-unavailable": "Borrow",
  "configuration-unavailable": "Identity verification",
} satisfies Record<CapabilityStateKind, string>;

function PlacementGallery({ placement }: { placement: CapabilityStatePlacement }) {
  const states = capabilityStateKinds.map((state) => (
    <CapabilityState
      key={state}
      capability={capabilityNames[state]}
      state={state}
      placement={placement}
      action={actions[state]}
    />
  ));

  if (placement === "tile") {
    return (
      <main className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <h1 className="sr-only">Capability states in Home tiles</h1>
        {states}
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl p-4">
      <h1 className="sr-only">Capability states in the {placement} placement</h1>
      {placement === "account" ? (
        <Card>
          <CardContent inset="list"><div className="divide-y">{states}</div></CardContent>
        </Card>
      ) : (
        <div className="space-y-3">{states}</div>
      )}
    </main>
  );
}

function AllPlacements({ state = "verification-rejected" }: { state?: CapabilityStateKind }) {
  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 p-4">
      <h1 className="sr-only">Capability state placement comparison</h1>
      <section className="space-y-2" aria-labelledby="tile-heading">
        <h2 id="tile-heading" className="text-lg font-semibold">Home tile</h2>
        <div className="max-w-sm">
          <CapabilityState capability="Add money" state={state} placement="tile" action={actions[state]} />
        </div>
      </section>
      <section className="space-y-2" aria-labelledby="row-heading">
        <h2 id="row-heading" className="text-lg font-semibold">Funding method row</h2>
        <CapabilityState capability="Bank transfer" state={state} placement="row" action={actions[state]} />
      </section>
      <section className="space-y-2" aria-labelledby="detail-heading">
        <h2 id="detail-heading" className="text-lg font-semibold">Product detail action</h2>
        <CapabilityState capability="Buy this investment" state={state} placement="detail" action={actions[state]} />
      </section>
      <section className="space-y-2" aria-labelledby="account-heading">
        <h2 id="account-heading" className="text-lg font-semibold">Account</h2>
        <Card>
          <CardContent inset="list">
            <CapabilityState capability="Identity verification" state={state} placement="account" action={actions[state]} />
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

const longCopy = {
  statusLabel: "Zusätzliche Überprüfung erforderlich",
  title: "Deine Identitätsüberprüfung benötigt weitere Informationen",
  description: "Öffne die Überprüfung erneut und reiche die zusätzlich angeforderten Informationen ein, damit du internationale Banküberweisungen weiterhin verwenden kannst.",
  actionLabel: "Überprüfung fortsetzen",
};

function LongLocalizedGallery() {
  return (
    <main className="mx-auto w-full max-w-5xl space-y-4 p-4">
      <h1 className="sr-only">Long localized capability state copy</h1>
      {(["tile", "row", "detail", "account"] as const).map((placement) => (
        <CapabilityState
          key={placement}
          capability="Internationale Banküberweisungen"
          state="verification-rejected"
          placement={placement}
          action={{ kind: "resume-verification", onSelect: () => {} }}
          copy={longCopy}
        />
      ))}
    </main>
  );
}

function RootTextScale({ children }: { children: ReactNode }) {
  useEffect(() => {
    const previous = document.documentElement.style.fontSize;
    document.documentElement.style.fontSize = "200%";
    return () => {
      document.documentElement.style.fontSize = previous;
    };
  }, []);
  return children;
}

const meta = {
  id: "proposal-capability-states",
  title: "Proposals/Capability States",
  component: PlacementGallery,
  args: { placement: "tile" },
  parameters: {
    layout: "fullscreen",
    viewport: { defaultViewport: "mobile" },
    docs: {
      description: {
        component: "Provider-independent presentation proposal for issue #635. This is a shared vocabulary/menu, not a universal state machine: each capability declares only the subset that applies. Verification appears only for an authoritative KYC requirement such as funding, card, identity, or a provider-specific gate—never automatically for Save, Invest, or Borrow. Operational states such as no liquidity, stale quote, APY stale, health, and reducing-only remain feature-owned. The nine-state production component remains available and intentionally unwired before Jesse review.",
      },
    },
  },
} satisfies Meta<typeof PlacementGallery>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TilePlacement: Story = {};

export const FundingRowPlacement: Story = {
  args: { placement: "row" },
};

export const DetailCtaPlacement: Story = {
  args: { placement: "detail" },
  parameters: { viewport: { defaultViewport: "desktop" } },
};

export const AccountPlacement: Story = {
  args: { placement: "account" },
};

export const SameStateAllPlacements: Story = {
  render: () => <AllPlacements />,
  parameters: { viewport: { defaultViewport: "desktop" } },
};

export const LongLocalizedCopy: Story = {
  render: () => <LongLocalizedGallery />,
};

export const TwoHundredPercentText: Story = {
  render: () => (
    <RootTextScale>
      <AllPlacements state="temporarily-unavailable" />
    </RootTextScale>
  ),
  parameters: {
    viewport: { defaultViewport: "mobile" },
    docs: { description: { story: "The story root uses a 200% root font size so rem-based production typography expands rather than merely magnifying a screenshot." } },
  },
};

export const ReducedMotionReference: Story = {
  render: () => <AllPlacements state="temporarily-unavailable" />,
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement);
    const retryButtons = await screen.findAllByRole("button", { name: "Retry" });
    await expect(retryButtons).toHaveLength(4);
    await userEvent.click(retryButtons[0]);
  },
  parameters: {
    viewport: { defaultViewport: "mobile" },
    docs: { description: { story: "Stable target for real-browser prefers-reduced-motion emulation. Capability states add no spatial animation; owned buttons remove their short feedback transition under reduced motion." } },
  },
};
