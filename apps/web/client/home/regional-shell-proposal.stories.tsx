import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import {
  RegionalHomeShellProposal,
  type RegionalHomeCopy,
} from "./regional-shell-proposal";
import { regionalHomeCompositions } from "./regional-shell-proposal-fixtures";

const englishCopy: RegionalHomeCopy = {
  account: "Account",
  activity: "Activity",
  addMoney: "Add money",
  card: "Card",
  cashOut: "Cash out",
  countryNeeded: "Country needed",
  dollarProducts: "Dollar products",
  home: "Home",
  invest: "Invest",
  illustrativeNonCoverage: "Illustrative only — coverage not assessed",
  localMoney: "Local money",
  localYieldUnavailable: "Local yield unavailable",
  send: "Send",
  shownSeparately: "Shown separately from dollar products",
  totalBalance: "Total balance",
};

const meta = {
  id: "proposal-regional-home-shell",
  title: "Proposals/Regional Home Shell",
  component: RegionalHomeShellProposal,
  args: {
    activeNavigation: "home",
    composition: regionalHomeCompositions.GLOBAL,
    copy: englishCopy,
    onAccount: fn(),
    onAction: fn(),
    onNavigate: fn(),
  },
  parameters: {
    layout: "fullscreen",
    viewport: { defaultViewport: "mobile" },
  },
} satisfies Meta<typeof RegionalHomeShellProposal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Global: Story = {};
export const UnitedStates: Story = { args: { composition: regionalHomeCompositions.US } };
export const Brazil: Story = { args: { composition: regionalHomeCompositions.BR } };
export const Nigeria: Story = { args: { composition: regionalHomeCompositions.NG } };
export const Indonesia: Story = { args: { composition: regionalHomeCompositions.ID } };

export const IntentionalDesktop: Story = {
  args: { composition: regionalHomeCompositions.BR },
  parameters: { viewport: { defaultViewport: "desktop" } },
};

export const SmallMobileGermanLongCopy: Story = {
  args: {
    composition: regionalHomeCompositions.NG,
    copy: {
      ...englishCopy,
      account: "Konto",
      addMoney: "Geld hinzufügen",
      card: "Karte",
      cashOut: "Geld auszahlen",
      dollarProducts: "Produkte in US-Dollar",
      home: "Startseite",
      invest: "Investieren",
      localMoney: "Geld in Landeswährung",
      send: "Geld senden",
      totalBalance: "Gesamtguthaben in der gewählten Anzeigewährung",
    },
  },
  parameters: { viewport: { defaultViewport: "smallMobile" } },
};

export const FrenchAtTwoHundredPercentText: Story = {
  args: {
    composition: regionalHomeCompositions.BR,
    copy: {
      ...englishCopy,
      account: "Compte",
      addMoney: "Ajouter de l’argent",
      card: "Carte",
      cashOut: "Retirer des fonds",
      dollarProducts: "Produits libellés en dollars américains",
      home: "Accueil",
      invest: "Investir",
      localMoney: "Argent en monnaie locale",
      send: "Envoyer de l’argent",
      totalBalance: "Solde total dans la devise d’affichage choisie",
    },
  },
  render: (args) => (
    <div className="w-1/2" style={{ zoom: 2 }} data-text-scale="200%">
      <RegionalHomeShellProposal {...args} />
    </div>
  ),
  parameters: { viewport: { defaultViewport: "mobile" } },
};

export const RightToLeftDirection: Story = {
  args: { composition: regionalHomeCompositions.ID },
  render: (args) => (
    <div dir="rtl">
      <RegionalHomeShellProposal {...args} />
    </div>
  ),
};

export const KeyboardFocus: Story = {
  args: { composition: regionalHomeCompositions.US },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.tab();
    const account = canvas.getByRole("button", { name: "Account" });
    await expect(account).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole("button", { name: /Add money/ })).toHaveFocus();
  },
};

export const ReducedMotionReference: Story = {
  args: { composition: regionalHomeCompositions.BR },
  parameters: {
    docs: {
      description: {
        story: "Review with prefers-reduced-motion enabled. The proposal has no spatial entrance motion and removes button transform transitions through the owned Button contract.",
      },
    },
  },
};
