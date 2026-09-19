import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import {
  RegionalHomeShellProposal,
  type RegionalHomeComposition,
  type RegionalHomeCopy,
} from "./regional-shell-proposal";

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
  localMoney: "Local money",
  localYieldUnavailable: "Local yield unavailable",
  send: "Send",
  shownSeparately: "Shown separately from dollar products",
  totalBalance: "Total balance",
};

const sharedActivity = [
  { id: "salary", label: "Money added", detail: "Today", amount: "+ $1,250.00" },
  { id: "send", label: "Sent", detail: "Yesterday", amount: "− $48.20" },
] as const;

const compositions = {
  GLOBAL: {
    regionLabel: "Global presentation",
    totalBalance: "$12,480.32",
    localMoney: {
      title: "Choose your country",
      value: "—",
      detail: "Choose a country to see local money separately from dollars.",
    },
    dollarProducts: {
      title: "Dollar products",
      value: "$12,480.32",
      detail: "Dollar balances remain denominated in USD.",
    },
    localYield: {
      title: "Local savings",
      detail: "Choose a country to see whether a local-currency yield product is available.",
      state: "choose-country",
    },
    activity: sharedActivity,
  },
  US: {
    regionLabel: "United States · USD",
    totalBalance: "$12,480.32",
    localMoney: {
      title: "US dollars",
      value: "$10,340.24",
      detail: "Your local money and display currency are both USD.",
    },
    dollarProducts: {
      title: "Dollar products",
      value: "$2,140.08",
      detail: "Dollar savings and investments stay distinct from available cash.",
    },
    localYield: {
      title: "Dollar savings",
      detail: "The local and dollar denomination is the same, so this appears once.",
      state: "available",
    },
    activity: sharedActivity,
  },
  BR: {
    regionLabel: "Brasil · BRL",
    totalBalance: "R$ 68.400,20",
    localMoney: {
      title: "Dinheiro local",
      value: "R$ 55.810,12",
      detail: "Saldo local ilustrativo, separado dos produtos em dólar.",
    },
    dollarProducts: {
      title: "Produtos em dólar",
      value: "US$ 2.140,08",
      detail: "Continuam denominados em USD, mesmo quando o total é exibido em reais.",
    },
    localYield: {
      title: "Rendimento em reais",
      detail: "Nenhum produto de rendimento em moeda local está disponível nesta composição.",
      state: "unavailable",
    },
    activity: sharedActivity,
  },
  NG: {
    regionLabel: "Nigeria · NGN",
    totalBalance: "₦19,870,400.00",
    localMoney: {
      title: "Naira money",
      value: "₦16,450,200.00",
      detail: "Illustrative local money, shown separately from dollar products.",
    },
    dollarProducts: {
      title: "Dollar products",
      value: "$2,140.08",
      detail: "These products stay denominated in USD.",
    },
    localYield: {
      title: "Naira savings",
      detail: "No local-currency yield product is available in this composition.",
      state: "unavailable",
    },
    activity: sharedActivity,
  },
  ID: {
    regionLabel: "Indonesia · IDR",
    totalBalance: "Rp199.684.000",
    localMoney: {
      title: "Uang lokal",
      value: "Rp165.442.000",
      detail: "Saldo lokal ilustratif, terpisah dari produk dolar.",
    },
    dollarProducts: {
      title: "Produk dolar",
      value: "$2,140.08",
      detail: "Produk ini tetap dalam denominasi USD.",
    },
    localYield: {
      title: "Tabungan rupiah",
      detail: "Belum ada produk imbal hasil mata uang lokal dalam komposisi ini.",
      state: "unavailable",
    },
    activity: sharedActivity,
  },
} satisfies Record<string, RegionalHomeComposition>;

const meta = {
  id: "proposal-regional-home-shell",
  title: "Proposals/Regional Home Shell",
  component: RegionalHomeShellProposal,
  args: {
    activeNavigation: "home",
    composition: compositions.GLOBAL,
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
export const UnitedStates: Story = { args: { composition: compositions.US } };
export const Brazil: Story = { args: { composition: compositions.BR } };
export const Nigeria: Story = { args: { composition: compositions.NG } };
export const Indonesia: Story = { args: { composition: compositions.ID } };

export const IntentionalDesktop: Story = {
  args: { composition: compositions.BR },
  parameters: { viewport: { defaultViewport: "desktop" } },
};

export const SmallMobileGermanLongCopy: Story = {
  args: {
    composition: compositions.NG,
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
    composition: compositions.BR,
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
  args: { composition: compositions.ID },
  render: (args) => (
    <div dir="rtl">
      <RegionalHomeShellProposal {...args} />
    </div>
  ),
};

export const KeyboardFocus: Story = {
  args: { composition: compositions.US },
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
  args: { composition: compositions.BR },
  parameters: {
    docs: {
      description: {
        story: "Review with prefers-reduced-motion enabled. The proposal has no spatial entrance motion and removes button transform transitions through the owned Button contract.",
      },
    },
  },
};
