import "server-only";

import type { CardProviderName } from "./provider";

type ProviderDisclosure = Readonly<{ provider: string; records: string }>;
const disclosures: Partial<Record<CardProviderName, readonly ProviderDisclosure[]>> = {
  bridge: [
    { provider: "Bridge", records: "Card account, verification and active provider cards" },
    { provider: "Stripe", records: "Card and purchase records" },
  ],
  immersve: [{ provider: "Immersve", records: "Card account and purchase records" }],
};

export function getCardProviderDisclosures(provider: CardProviderName): readonly ProviderDisclosure[] | undefined {
  return disclosures[provider];
}
