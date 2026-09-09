import { LivelineQaClient } from "./liveline-qa-client";

export const metadata = {
  title: "Liveline QA · Codex real series",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function LivelineQaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const raw = query.asset;
  const assetId = typeof raw === "string" && raw.length > 0 ? raw : "cbbtc";
  return <LivelineQaClient assetId={assetId} />;
}
