import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button } from "@/components/ui/button";
import { shellContentFrameClassName } from "@/components/shell-layout";
import {
  MoneyModal,
  MoneyModalBody,
  MoneyModalFooter,
  MoneyModalHeader,
} from "@/client/money-modal";
import { CardExperience } from "./card-experience";
import type {
  CardActivitySummary,
  CardExperienceProps,
  CardJourneyState,
  IssuedCardState,
} from "./card-types";

const activity: readonly CardActivitySummary[] = [
  {
    id: "purchase-1",
    merchant: "Corner Market",
    occurredAt: "Today, 10:42 AM",
    amount: "−$24.80",
    status: "settled",
    statusDetail: "Completed",
  },
  {
    id: "purchase-2",
    merchant: "Metro Transit",
    occurredAt: "Yesterday, 6:15 PM",
    amount: "−$3.25",
    status: "pending",
    statusDetail: "Final amount may change",
  },
  {
    id: "purchase-3",
    merchant: "Northstar Outfitters",
    occurredAt: "Sep 17",
    amount: "+$86.00",
    status: "refunded",
    statusDetail: "Returned to available funds",
  },
];

const activeState: IssuedCardState = {
  kind: "issued",
  status: "active",
  form: "virtual",
  walletState: "not-offered",
  availableToSpend: "$420.75",
  fundingSource: "Funded from USD Coin",
  allocationLabel: "$420.75 is allocated from your Home balance—not counted twice.",
  updatedAt: "just now",
  serviceStatus: "available",
  controls: [
    {
      id: "online",
      label: "Online purchases",
      description: "Allow purchases where the card is not physically present.",
      enabled: true,
    },
    {
      id: "contactless",
      label: "Contactless purchases",
      description: "Allow tap-to-pay where the card format supports it.",
      enabled: true,
    },
    {
      id: "cash",
      label: "Cash withdrawals",
      description: "Not available for this card program.",
      enabled: false,
      available: false,
    },
  ],
  limits: [
    { label: "Daily spending limit", value: "$1,000.00", detail: "$579.25 remaining today" },
    { label: "Single purchase limit", value: "$500.00" },
  ],
  activity,
};

function FundingEntry({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button className="h-11 w-full" disabled={disabled} onClick={() => setOpen(true)}>
        Add funds
      </Button>
      <MoneyModal
        open={open}
        labelledBy="card-funding-title"
        describedBy="card-funding-description"
        onCancel={() => setOpen(false)}
        onClose={() => setOpen(false)}
      >
        <MoneyModalHeader title="Add card funds" titleId="card-funding-title" onClose={() => setOpen(false)} />
        <MoneyModalBody hasFooter>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground" id="card-funding-description">
              Move money from available USD Coin into the card allocation.
            </p>
            <div className="space-y-1 rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">Amount</p>
              <p className="text-3xl font-semibold tabular-nums">$100.00</p>
              <p className="text-sm text-muted-foreground">$840.25 available in Home</p>
            </div>
          </div>
        </MoneyModalBody>
        <MoneyModalFooter primaryLabel="Review allocation" onPrimary={() => setOpen(false)} />
      </MoneyModal>
    </>
  );
}

function CardStorySurface({ state, textScale = false }: { state: CardJourneyState; textScale?: boolean }) {
  const [current, setCurrent] = useState(state);
  const [secureOpen, setSecureOpen] = useState(false);
  const issued = current.kind === "issued" ? current : null;

  useEffect(() => {
    if (!textScale) return;
    const previous = document.documentElement.style.fontSize;
    document.documentElement.style.fontSize = "200%";
    return () => {
      document.documentElement.style.fontSize = previous;
    };
  }, [textScale]);

  const updateIssued = (update: (value: IssuedCardState) => IssuedCardState) => {
    setCurrent((value) => value.kind === "issued" ? update(value) : value);
  };

  const handlers: Omit<CardExperienceProps, "state"> = {
    fundingEntry: issued ? ({ disabled }) => <FundingEntry disabled={disabled} /> : undefined,
    onStartIssuance: () => {},
    onStartVerification: () => {},
    onOpenSecureDetails: issued ? () => setSecureOpen(true) : undefined,
    onFreezeChange: issued
      ? (frozen) => updateIssued((value) => ({ ...value, status: frozen ? "frozen" : "active" }))
      : undefined,
    onControlChange: issued
      ? (controlId, enabled) => updateIssued((value) => ({
          ...value,
          controls: value.controls.map((control) => control.id === controlId ? { ...control, enabled } : control),
        }))
      : undefined,
    onRequestWalletProvisioning: issued?.walletState === "eligible" ? () => {} : undefined,
    onOpenActivity: () => {},
    onContactSupport: () => {},
  };

  return (
    <div>
      <div className={`${shellContentFrameClassName} py-4`}>
        <CardExperience state={current} {...handlers} />
      </div>
      <MoneyModal
        open={secureOpen}
        labelledBy="secure-card-details-title"
        describedBy="secure-card-details-description"
        onCancel={() => setSecureOpen(false)}
        onClose={() => setSecureOpen(false)}
      >
        <MoneyModalHeader title="Secure card details" titleId="secure-card-details-title" onClose={() => setSecureOpen(false)} />
        <MoneyModalBody hasFooter>
          <div className="space-y-3 py-4">
            <p id="secure-card-details-description" className="text-sm text-muted-foreground">
              Re-authenticate before the card partner opens its protected details view.
            </p>
            <p className="text-sm">Card number and security code are never rendered in this Home surface.</p>
          </div>
        </MoneyModalBody>
        <MoneyModalFooter primaryLabel="Continue securely" onPrimary={() => setSecureOpen(false)} />
      </MoneyModal>
    </div>
  );
}

const meta = {
  id: "proposal-card-journey",
  title: "Proposals/Card Journey",
  component: CardStorySurface,
  args: { state: activeState },
  parameters: {
    layout: "fullscreen",
    viewport: { defaultViewport: "mobile" },
  },
} satisfies Meta<typeof CardStorySurface>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EligibleEntry: Story = {
  args: {
    state: { kind: "not-issued", eligibility: "eligible", identityRequirement: { kind: "none" } },
  },
};

export const VerificationRequired: Story = {
  args: {
    state: {
      kind: "not-issued",
      eligibility: "verification-required",
      identityRequirement: {
        kind: "provider-hosted",
        label: "Complete verification with the card partner. Home does not collect identity documents.",
      },
    },
  },
};

export const VerificationReuseAccepted: Story = {
  args: {
    state: {
      kind: "not-issued",
      eligibility: "eligible",
      identityRequirement: {
        kind: "reuse-accepted",
        label: "This card partner accepts your existing operator verification.",
      },
    },
  },
};

export const VerificationPending: Story = {
  args: {
    state: {
      kind: "not-issued",
      eligibility: "verification-pending",
      identityRequirement: {
        kind: "provider-hosted",
        label: "Status comes from the card partner and may take time to update.",
      },
    },
  },
};

export const CountryUnavailable: Story = {
  args: {
    state: { kind: "not-issued", eligibility: "country-unavailable", identityRequirement: { kind: "none" } },
  },
};

export const ActiveVirtual: Story = {};

export const ActivePhysical: Story = {
  args: { state: { ...activeState, form: "physical" } },
  parameters: { viewport: { defaultViewport: "desktop" } },
};

export const WalletProvisioningEligible: Story = {
  args: { state: { ...activeState, form: "virtual", walletState: "eligible" } },
};

export const WalletProvisioned: Story = {
  args: { state: { ...activeState, walletState: "provisioned" } },
};

export const Frozen: Story = {
  args: { state: { ...activeState, status: "frozen" } },
};

export const LowFunds: Story = {
  args: { state: { ...activeState, availableToSpend: "$12.40", lowFunds: true } },
};

export const EmptyActivity: Story = {
  args: { state: { ...activeState, activity: [] } },
};

export const PendingPurchase: Story = {
  args: { state: { ...activeState, activity: [activity[1]!] } },
};

export const DeclinedPurchase: Story = {
  args: {
    state: {
      ...activeState,
      activity: [{
        id: "decline-1",
        merchant: "Harbor Grocer",
        occurredAt: "Today, 8:02 AM",
        amount: "$68.20",
        status: "declined",
        statusDetail: "Not charged · Available funds were too low",
      }],
    },
  },
};

export const ReversedPurchase: Story = {
  args: {
    state: {
      ...activeState,
      activity: [{
        id: "reversal-1",
        merchant: "City Hotel",
        occurredAt: "Sep 16",
        amount: "+$180.00",
        status: "reversed",
        statusDetail: "Authorization released",
      }],
    },
  },
};

export const RefundedPurchase: Story = {
  args: { state: { ...activeState, activity: [activity[2]!] } },
};

export const ProviderOutage: Story = {
  args: {
    state: {
      ...activeState,
      serviceStatus: "outage",
      updatedAt: "Sep 18, 4:10 PM",
    },
  },
};

export const SmallMobileSafety: Story = {
  parameters: { viewport: { defaultViewport: "smallMobile" } },
};

export const LongLocalizedContent: Story = {
  args: {
    state: {
      ...activeState,
      fundingSource: "Financiado desde el saldo disponible de moneda digital en dólares estadounidenses",
      allocationLabel: "Esta cantidad está reservada para la tarjeta y sigue incluida una sola vez en el saldo total de Home.",
      controls: [{
        id: "international-online",
        label: "Compras internacionales por internet y por teléfono",
        description: "Permitir compras cuando la tarjeta física no está presente y el comercio procesa el pago desde otro país.",
        enabled: true,
      }],
      limits: [{
        label: "Límite acumulado de gastos durante el día calendario",
        value: "$1,000.00",
        detail: "$579.25 disponibles antes del próximo restablecimiento diario",
      }],
      activity: [{
        id: "long-merchant",
        merchant: "Cooperativa Internacional de Alimentos y Productos para el Hogar",
        occurredAt: "Hoy, 10:42 a. m.",
        amount: "−$124.80",
        status: "pending",
        statusDetail: "El importe final puede cambiar cuando el comercio complete la compra",
      }],
    },
  },
  parameters: { viewport: { defaultViewport: "smallMobile" } },
};

export const TextAtTwoHundredPercent: Story = {
  args: { textScale: true },
  parameters: { viewport: { defaultViewport: "desktop" } },
};

export const ReducedMotion: Story = {
  parameters: {
    docs: { description: { story: "Reference state for prefers-reduced-motion review; all owned controls remain immediate." } },
  },
};
