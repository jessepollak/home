import { redirect } from "next/navigation";
import { shellOverlayRedirectHref } from "@/config/shell-location";

export const instant = false;

export default async function BalancesRedirect({ params, searchParams }: PageProps<"/balances/[[...group]]">) {
  const segments = (await params).group ?? [];
  const [group] = segments;
  const recognized = segments.length <= 1 && (group === undefined || group === "cash" || group === "investments");
  const target = !recognized ? "/home" : group === "investments" ? "/investments" : "/cash";
  redirect(shellOverlayRedirectHref(target, await searchParams));
}
