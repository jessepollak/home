import "server-only";

import type { CountryCode, RegionOffer } from "@/config/regions";
import { readCountryPreferenceForRender } from "@/server/preferences/country";
import type { CountryPreferenceSeed } from "@/shared/account/contracts/country-preference";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { InvestSettings } from "@/shared/operator-settings/invest";
import { readInvestSettingsForRender } from "./invest";
import { readRegionOfferForRender } from "./regions";

type ShellPolicyReaders = {
  readCountryPreference?: (session: VerifiedAccountSession) => Promise<{ regionId: CountryCode | null } | null>;
  readInvestSettings?: () => Promise<InvestSettings>;
  readRegionOffer?: () => Promise<RegionOffer>;
};

export async function readShellPolicyForRender(
  session: VerifiedAccountSession | null,
  {
    readCountryPreference = readCountryPreferenceForRender,
    readInvestSettings = readInvestSettingsForRender,
    readRegionOffer = readRegionOfferForRender,
  }: ShellPolicyReaders = {},
): Promise<{ accountPreference: CountryPreferenceSeed | null; investVisibility: InvestSettings; regionOffer: RegionOffer }> {
  const preference = session ? await readCountryPreference(session) : null;
  const [investVisibility, regionOffer] = await Promise.all([
    readInvestSettings(),
    readRegionOffer(),
  ]);
  return {
    accountPreference: session && preference
      ? { accountProvider: session.accountProvider, subject: session.user.subject, regionId: preference.regionId }
      : null,
    investVisibility,
    regionOffer,
  };
}
