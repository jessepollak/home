import { SupportedGlobeDynamic } from "@/client/landing/supported-globe-dynamic";
import { PortfolioHomeExperience } from "@/client/home/home-experience";
import { searchParamsToString } from "@/config/shell-location";

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const query = await searchParams;
  // Server geo can later pass a detected country here. The anonymous persisted
  // preference is resolved inside the client boundary; URL shell state is passed
  // from the request so the server and client render the same initial intent.
  return (
    <PortfolioHomeExperience
      detectedCountry={null}
      landingVisual={<SupportedGlobeDynamic />}
      routeMode="landing"
      initialSearch={searchParamsToString(query)}
    />
  );
}
