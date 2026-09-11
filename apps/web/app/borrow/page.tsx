import type { Metadata } from "next";
import { AuthenticatedBorrowExperience } from "@/client/borrowing/borrowing-experience";

export const metadata: Metadata = {
  title: "Borrow · Home",
  description: "Manage the supported Base Morpho cbBTC collateral and USDC loan market.",
};

export default function BorrowPage() {
  return <AuthenticatedBorrowExperience />;
}
