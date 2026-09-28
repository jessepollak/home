import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SupportedGlobeDynamic } from "@/client/landing/supported-globe-dynamic";
import { LandingShell } from "@/client/home/landing-shell";
import { searchParamsToString } from "@/config/shell-location";
import { signedInLandingHref } from "@/server/landing/signed-in-redirect";
import { readRequestCountry } from "@/server/region/request-country";
import { readRegionOfferForRender } from "@/server/operator-settings/regions";

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const query = await searchParams;
  const search = searchParamsToString(query);
  const href = signedInLandingHref(query, await cookies());
  if (href) redirect(href);

  return (
    <LandingShell
      detectedCountry={readRequestCountry(await headers())}
      regionOffer={await readRegionOfferForRender()}
      landingVisual={<SupportedGlobeDynamic />}
      initialSearch={search}
    />
  );
}
