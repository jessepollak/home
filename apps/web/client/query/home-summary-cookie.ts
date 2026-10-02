import { homeSummaryCookieName, encodeHomeSummaryCookie, type HomeSummaryRecord } from "@/shared/balances/home-summary";

export function clearHomeSummaryCookie(): boolean {
  if (typeof document === "undefined") return false;
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
