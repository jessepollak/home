import { notFound } from "next/navigation";
import DashboardPage from "../../dashboard/page";
import { isSaveQaRouteEnabled } from "./fixtures";
import { SaveQaClient } from "./save-qa-client";

export default async function SaveQaPage() {
  if (!isSaveQaRouteEnabled(process.env.NODE_ENV, process.env.HOME_ENABLE_SAVE_QA)) notFound();

  const dashboard = await DashboardPage({
    searchParams: Promise.resolve({ panel: "save" }),
  });

  return <SaveQaClient>{dashboard}</SaveQaClient>;
}
