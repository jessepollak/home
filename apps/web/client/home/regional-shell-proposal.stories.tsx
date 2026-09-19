import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import {
  RegionalHomeShellProposal,
  type RegionalHomeComposition,
  type RegionalHomeCopy,
} from "./regional-shell-proposal";

const sharedActivity = [
  {
    id: "salary",
    direction: "incoming",
    label: "Money added",
    detail: "Today",
    amount: "+ $1,250.00",
  },
  {
    id: "send",
    direction: "outgoing",
    label: "Sent",
    detail: "Yesterday",
    amount: "− $48.20",
  },
] as const;

const regionalHomeCompositions = {
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

const englishCopy: RegionalHomeCopy = {
  account: "Account",
  activity: "Activity",
  activityEmpty: "No activity yet",
  addMoney: "Add money",
  card: "Card",
  cashOut: "Cash out",
  countryNeeded: "Country needed",
  desktopPrimaryNavigation: "Desktop primary navigation",
  dollarProducts: "Dollar products",
  home: "Home",
  invest: "Invest",
  localMoney: "Local money",
  localYieldUnavailable: "Local yield unavailable",
  mobilePrimaryNavigation: "Mobile primary navigation",
  moneyActions: "Money actions",
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
export const UnitedStates: Story = {
  args: { composition: regionalHomeCompositions.US },
  parameters: {
    docs: {
      description: {
        story: "The United States fixture intentionally omits the local-yield proposal because this design fixture does not establish whether that product is available or unavailable.",
      },
    },
  },
};
export const Brazil: Story = { args: { composition: regionalHomeCompositions.BR } };
export const Nigeria: Story = { args: { composition: regionalHomeCompositions.NG } };
export const Indonesia: Story = { args: { composition: regionalHomeCompositions.ID } };
export const EmptyActivity: Story = {
  args: {
    composition: { ...regionalHomeCompositions.GLOBAL, activity: [] },
  },
};

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
      activityEmpty: "Noch keine Aktivitäten",
      addMoney: "Geld hinzufügen",
      card: "Karte",
      cashOut: "Geld auszahlen",
      desktopPrimaryNavigation: "Primäre Navigation für Desktop",
      dollarProducts: "Produkte in US-Dollar",
      home: "Startseite",
      invest: "Investieren",
      localMoney: "Geld in Landeswährung",
      mobilePrimaryNavigation: "Primäre Navigation für Mobilgeräte",
      moneyActions: "Geldaktionen",
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
      activityEmpty: "Aucune activité pour le moment",
      addMoney: "Ajouter de l’argent",
      card: "Carte",
      cashOut: "Retirer des fonds",
      desktopPrimaryNavigation: "Navigation principale sur ordinateur",
      dollarProducts: "Produits libellés en dollars américains",
      home: "Accueil",
      invest: "Investir",
      localMoney: "Argent en monnaie locale",
      mobilePrimaryNavigation: "Navigation principale sur mobile",
      moneyActions: "Actions financières",
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
  args: {
    composition: regionalHomeCompositions.ID,
    copy: {
      ...englishCopy,
      activityEmpty: "لا يوجد نشاط حتى الآن",
      desktopPrimaryNavigation: "التنقل الأساسي لسطح المكتب",
      mobilePrimaryNavigation: "التنقل الأساسي للجوال",
      moneyActions: "إجراءات الأموال",
    },
  },
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
