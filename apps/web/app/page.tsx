import { SupportedGlobe } from "@/client/landing/supported-globe";
import { PortfolioHomeExperience } from "@/client/home/home-experience";

type HomePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const query = await searchParams;
  // Server geo can later pass a detected country here. Anonymous persisted
  // preference is intentionally resolved inside the client boundary.
  return (
    <PortfolioHomeExperience
      detectedCountry={null}
      initialAccountOpen={query.account === "signin"}
      landingVisual={<SupportedGlobe />}
      routeMode="landing"
    />
  );
}
