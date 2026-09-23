import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SupportedGlobeDynamic } from "@/client/landing/supported-globe-dynamic";
import { PortfolioHomeExperience } from "@/client/home/home-experience";
import {
  homeHrefWithOverlays,
  readShellAccountParam,
  searchParamsToString,
} from "@/config/shell-location";
import { readRenderSession } from "@/server/auth/render-session";
import { readRequestCountry } from "@/server/region/request-country";

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const query = await searchParams;
  const search = searchParamsToString(query);
  const rendered = readRenderSession(await cookies());
  if (rendered && readShellAccountParam(query) !== "signin") {
    redirect(homeHrefWithOverlays(query));
  }

  return (
    <PortfolioHomeExperience
      detectedCountry={readRequestCountry(await headers())}
      landingVisual={<SupportedGlobeDynamic />}
      routeMode="landing"
      initialSearch={search}
    />
  );
}
