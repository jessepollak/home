import "server-only";

import type { CountryCode, RegionOffer } from "@/config/regions";
import { readCountryPreferenceForRender } from "@/server/preferences/country";
import type { CountryPreferenceSeed } from "@/shared/account/contracts/country-preference";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { InvestSettings } from "@/shared/operator-settings/invest";
import type { ProductOffering } from "@/shared/operator-settings/products";
import { readInvestSettingsForRender } from "./invest";
import { readProductOffering as readProductOfferingForRender } from "./offering";
import { readRegionOfferForRender } from "./regions";

type ShellPolicyReaders = {
  readCountryPreference?: (session: VerifiedAccountSession) => Promise<{ regionId: CountryCode | null } | null>;
  readInvestSettings?: () => Promise<InvestSettings>;
  readProductOffering?: () => Promise<ProductOffering>;
  readRegionOffer?: () => Promise<RegionOffer>;
};

export async function readShellPolicyForRender(
  session: VerifiedAccountSession | null,
  {
    readCountryPreference = readCountryPreferenceForRender,
    readInvestSettings = readInvestSettingsForRender,
    readProductOffering = readProductOfferingForRender,
    readRegionOffer = readRegionOfferForRender,
  }: ShellPolicyReaders = {},
): Promise<{ accountPreference: CountryPreferenceSeed | null; investVisibility: InvestSettings; productOffering: ProductOffering; regionOffer: RegionOffer }> {
  const preference = session ? await readCountryPreference(session) : null;
  const [investVisibility, regionOffer] = await Promise.all([
    readInvestSettings(),
    readRegionOffer(),
  ]);
  const productOffering = await readProductOffering();
  return {
    accountPreference: session && preference
      ? { accountProvider: session.accountProvider, subject: session.user.subject, regionId: preference.regionId }
      : null,
    investVisibility,
    productOffering,
    regionOffer,
  };
}
