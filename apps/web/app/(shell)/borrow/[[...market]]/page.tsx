import type { Metadata } from "next";
import { BorrowPageContent } from "@/client/home/shell-pages";

export const metadata: Metadata = { title: "Borrow · Home", description: "Your verified Home account." };

export default function Page() {
  return <BorrowPageContent />;
}
