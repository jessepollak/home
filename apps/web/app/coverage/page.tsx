import type { Metadata } from "next";
import { CoverageView } from "@/client/coverage/coverage-view";
import { brandedPageTitle } from "@/server/operator-settings/brand";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: await brandedPageTitle("Local money coverage"),
    description: "Documented local-money coverage signals: stablecoin candidates, 1:1 onramp research, portfolio priority, and integration status.",
  };
}

export const instant = false;

export default async function CoveragePage({ searchParams }: PageProps<"/coverage">) {
  return <CoverageView query={await searchParams} />;
}
