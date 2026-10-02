import { dataOwnerKey } from "@/shared/account/data-owner";
import { homeSummaryCookieName, parseHomeSummaryCookie } from "@/shared/balances/home-summary";
import { resolvePresentation } from "@/config/regions";
import { cookies, headers } from "next/headers";
import { Suspense } from "react";
import { AccountRouteProvider } from "@/client/account/account-route-provider";
import { normalizeProjectId } from "@/client/account/session-client";
import { isHomeSessionConfigured } from "@/server/auth/native-base-session";
import { PortfolioHomeExperience } from "@/client/home/portfolio-home-experience";
import { readRequestCountry } from "@/server/region/request-country";
import { readRenderSession } from "@/server/auth/render-session";
import { readShellPolicyForRender } from "@/server/operator-settings/shell-policy";
import { cardJourneyEnabled } from "@/server/cards/bridge/journey-config";

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={null}><ShellContent>{children}</ShellContent></Suspense>;
}

async function ShellContent({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const rendered = readRenderSession(cookieStore);
  const { accountPreference, investVisibility, regionOffer } = await readShellPolicyForRender(rendered?.session ?? null);
  const detectedCountry = readRequestCountry(await headers());
  const region = resolvePresentation({ persistedCountry: accountPreference?.regionId, detectedCountry, offer: regionOffer }).region.id;
  const summaryCookies = cookieStore.getAll(homeSummaryCookieName);
  const initialHomeSummary = rendered?.session.smartAccount && summaryCookies.length === 1
    ? parseHomeSummaryCookie(summaryCookies[0]?.value, dataOwnerKey(rendered.session), region) : null;
  return (
    <AccountRouteProvider
      projectId={normalizeProjectId(process.env.NEXT_PUBLIC_CDP_PROJECT_ID)}
      baseAccountEnabled={isHomeSessionConfigured(process.env.HOME_SESSION_SECRET)}
      smokeFixture={process.env.HOME_PLAYWRIGHT_SMOKE === "1" && !process.env.VERCEL}
      renderSeed={rendered}
      hideWhileLoading
    >
      <PortfolioHomeExperience
        detectedCountry={detectedCountry}
        initialHomeSummary={initialHomeSummary}
        regionOffer={regionOffer}
        accountPreference={accountPreference}
        investVisibility={investVisibility}
        cardsEnabled={cardJourneyEnabled()}
      >
        {children}
      </PortfolioHomeExperience>
    </AccountRouteProvider>
  );
}
