import type { Metadata } from "next";
import { InvestPageContent } from "@/client/home/shell-pages";

export const metadata: Metadata = { title: "Invest · Home", description: "Your verified Home account." };

export default function Page() {
  return <InvestPageContent />;
}
