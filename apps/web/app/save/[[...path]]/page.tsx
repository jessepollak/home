import { redirect } from "next/navigation";
import { legacyShellRedirectHref } from "@/config/shell-location";

export const instant = false;

export default async function SaveRedirect({ searchParams }: PageProps<"/save/[[...path]]">) {
  redirect(legacyShellRedirectHref("/save", await searchParams) ?? "/cash/savings");
}
