import { cookies, headers } from "next/headers";
import { Suspense } from "react";
import { AccountRouteProvider } from "@/client/account/account-route-provider";
import { normalizeProjectId } from "@/client/account/session-client";
import { isHomeSessionConfigured } from "@/server/auth/native-base-session";
import { PortfolioHomeExperience } from "@/client/home/portfolio-home-experience";
import { readRequestCountry } from "@/server/region/request-country";
import { readRenderSession } from "@/server/auth/render-session";
import { readCountryPreferenceForRender } from "@/server/preferences/country";
import { readRegionOfferForRender } from "@/server/operator-settings/regions";
import { readInvestSettingsForRender } from "@/server/operator-settings/invest";
import { cardJourneyEnabled } from "@/server/cards/bridge/journey-config";

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={null}><ShellContent>{children}</ShellContent></Suspense>;
}

async function ShellContent({ children }: { children: React.ReactNode }) {
  const rendered = readRenderSession(await cookies());
  const preference = rendered ? await readCountryPreferenceForRender(rendered.session) : null;
  const accountPreference = rendered && preference
    ? { accountProvider: rendered.session.accountProvider, subject: rendered.session.user.subject, regionId: preference.regionId }
    : null;
  const investVisibility = await readInvestSettingsForRender();
  return (
    <AccountRouteProvider
      projectId={normalizeProjectId(process.env.NEXT_PUBLIC_CDP_PROJECT_ID)}
      baseAccountEnabled={isHomeSessionConfigured(process.env.HOME_SESSION_SECRET)}
      smokeFixture={process.env.HOME_PLAYWRIGHT_SMOKE === "1" && !process.env.VERCEL}
      renderSeed={rendered}
      hideWhileLoading
    >
      <PortfolioHomeExperience
        detectedCountry={readRequestCountry(await headers())}
        regionOffer={await readRegionOfferForRender()}
        accountPreference={accountPreference}
        investVisibility={investVisibility}
        cardsEnabled={cardJourneyEnabled()}
      >
        {children}
      </PortfolioHomeExperience>
    </AccountRouteProvider>
  );
}
