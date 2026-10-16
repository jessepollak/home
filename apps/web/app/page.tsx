import { cookies, headers } from "next/headers";
import { AccountRouteProvider } from "@/client/account/account-route-provider";
import { normalizeProjectId } from "@/client/account/session-client";
import { isHomeSessionConfigured } from "@/server/auth/native-base-session";
import { readRenderSession } from "@/server/auth/render-session";
import { redirect } from "next/navigation";
import { SupportedGlobeDynamic } from "@/client/landing/supported-globe-dynamic";
import { LandingShell } from "@/client/home/landing-shell";
import { searchParamsToString } from "@/config/shell-location";
import { signedInLandingHref } from "@/server/landing/signed-in-redirect";
import { readRequestCountry } from "@/server/region/request-country";
import { readRegionOfferForRender } from "@/server/operator-settings/regions";

export const instant = false;

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const query = await searchParams;
  const search = searchParamsToString(query);
  const cookieStore = await cookies();
  const href = await signedInLandingHref(query, cookieStore);
  if (href) redirect(href);

  return (
    <AccountRouteProvider
      projectId={normalizeProjectId(process.env.NEXT_PUBLIC_CDP_PROJECT_ID)}
      baseAccountEnabled={isHomeSessionConfigured(process.env.HOME_SESSION_SECRET)}
      smokeFixture={process.env.HOME_PLAYWRIGHT_SMOKE === "1" && !process.env.VERCEL}
      renderSeed={await readRenderSession(cookieStore)}
    >
      <LandingShell
        detectedCountry={readRequestCountry(await headers())}
        regionOffer={await readRegionOfferForRender()}
        landingVisual={<SupportedGlobeDynamic />}
        initialSearch={search}
      />
    </AccountRouteProvider>
  );
}
