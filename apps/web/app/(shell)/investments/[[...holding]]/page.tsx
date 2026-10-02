import type { Metadata } from "next";
import { InvestmentsPageContent } from "@/client/home/shell-pages";

export const metadata: Metadata = { title: "Investments · Home", description: "Your verified Home account." };

export default function Page() {
  return <InvestmentsPageContent />;
}
