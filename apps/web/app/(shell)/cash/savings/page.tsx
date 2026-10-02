import type { Metadata } from "next";
import { CashPageContent } from "@/client/home/shell-pages";

export const metadata: Metadata = { title: "Savings · Home", description: "Your verified Home account." };

export default function Page() {
  return <CashPageContent />;
}
