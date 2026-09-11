import DashboardPage from "../../dashboard/page";
import { SaveQaClient } from "./save-qa-client";

export default async function EnabledSaveQaPage() {
  const dashboard = await DashboardPage({
    searchParams: Promise.resolve({ panel: "save" }),
  });

  return <SaveQaClient>{dashboard}</SaveQaClient>;
}
