import { homeSummaryCookieName, encodeHomeSummaryCookie, type HomeSummaryRecord } from "@/shared/balances/home-summary";

function cookieOwner(): string | null {
  try {
    const value = document.cookie.split("; ").find((entry) => entry.startsWith(`${homeSummaryCookieName}=`))?.slice(homeSummaryCookieName.length + 1);
    if (!value || value.length > 3_500) return null;
    const record: unknown = JSON.parse(decodeURIComponent(value));
    return record && typeof record === "object" && "owner" in record && typeof record.owner === "string" ? record.owner : null;
  } catch { return null; }
}

export function clearHomeSummaryCookie(preservedOwner?: string): boolean {
  if (typeof document === "undefined") return false;
  if (preservedOwner && cookieOwner() === preservedOwner) return true;
  try { document.cookie = `${homeSummaryCookieName}=; Path=/home; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`; return true; } catch { return false; }
}
export function writeHomeSummaryCookie(record: HomeSummaryRecord | null): boolean {
  if (typeof document === "undefined") return false;
  const value = record ? encodeHomeSummaryCookie(record) : null;
  if (!value) return clearHomeSummaryCookie();
  try {
    document.cookie = `${homeSummaryCookieName}=${value}; Path=/home; Max-Age=604800; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    return true;
  } catch { return false; }
}
