import type { Metadata } from "next";
import { HomePageContent } from "@/client/home/shell-pages";

export const metadata: Metadata = { title: "Home · Home", description: "Your verified Home account." };

export default function Page() {
  return <HomePageContent />;
}
