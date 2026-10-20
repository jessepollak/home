import type { Metadata } from "next";
import { brandedPageTitle } from "@/server/operator-settings/brand";
import { BorrowPageContent } from "@/client/home/shell-pages";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await brandedPageTitle("Borrow") };
}

export default function Page() {
  return <BorrowPageContent />;
}
