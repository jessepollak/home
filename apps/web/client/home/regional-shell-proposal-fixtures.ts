import type { RegionalHomeComposition } from "./regional-shell-proposal";

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

export const regionalHomeCompositions = {
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
      title: "Dollar savings layout",
      detail: "Illustrative placement only; this fixture does not assess regional coverage.",
      state: "illustrative",
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
