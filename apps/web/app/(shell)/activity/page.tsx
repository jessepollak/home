import type { Metadata } from "next";
import { ActivityPageContent } from "@/client/home/shell-pages";

export const metadata: Metadata = { title: "Activity · Home", description: "Your verified Home account." };

export default function Page() {
  return <ActivityPageContent />;
}
