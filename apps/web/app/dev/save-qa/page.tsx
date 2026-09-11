import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SaveQaPage() {
  if (process.env.NODE_ENV === "production") notFound();
  if (process.env.NODE_ENV !== "development" || process.env.HOME_ENABLE_SAVE_QA !== "1") {
    notFound();
  }

  const { default: EnabledSaveQaPage } = await import("./enabled-page");
  return <EnabledSaveQaPage />;
}
