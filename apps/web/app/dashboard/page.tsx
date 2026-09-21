import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Home · Home",
  description: "Your verified Home account.",
};

export default function DashboardPage() {
  redirect("/home");
}
