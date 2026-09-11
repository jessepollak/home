export type BasenameProfile = {
  name: string | null;
  avatarUrl: string | null;
};

export const BASENAME_PROFILE_PATH = "/ens/resolve/";

/** Public ENS/Basename resolver. Fail-open: any error returns null. */
export function basenameProfileUrl(address: string): string {
  return `https://api.ensideas.com${BASENAME_PROFILE_PATH}${encodeURIComponent(address)}`;
}

export function profileGlyph({
  basename,
  ownerKey,
  address,
}: {
  basename?: string | null;
  ownerKey?: string | null;
  address?: string | null;
}): string {
  return (
    firstLetter(basename) ??
    firstLetter(emailLocalPart(ownerKey)) ??
    firstLetter(ownerKey) ??
    firstLetter(address?.replace(/^0x/i, "") ?? null) ??
    ""
  );
}

export function parseBasenameProfile(value: unknown): BasenameProfile | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const name = readName(record);
  const avatarUrl = readAvatarUrl(record);
  if (!name && !avatarUrl) return null;
  return { name, avatarUrl };
}

export type ProfileFetch = (
  input: string,
  init?: { headers?: HeadersInit; signal?: AbortSignal },
) => Promise<Response>;

export async function fetchBasenameProfile(
  address: string | null | undefined,
  fetchImpl: ProfileFetch = fetch,
  signal?: AbortSignal,
): Promise<BasenameProfile | null> {
  if (!address || !isAddress(address)) return null;
  try {
    const response = await fetchImpl(basenameProfileUrl(address), {
      headers: { accept: "application/json" },
      signal,
    });
    if (!response.ok) return null;
    return parseBasenameProfile(await response.json());
  } catch {
    return null;
  }
}

function firstLetter(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.normalize("NFKC").match(/\p{L}|\p{N}/u);
  return match ? match[0].toLocaleLowerCase() : null;
}

function emailLocalPart(value: string | null | undefined): string | null {
  if (!value || !value.includes("@")) return null;
  return value.slice(0, value.indexOf("@"));
}

function readName(record: Record<string, unknown>): string | null {
  for (const key of ["name", "ens", "basename"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function readAvatarUrl(record: Record<string, unknown>): string | null {
  for (const key of ["avatar", "avatar_url", "ens_avatar"] as const) {
    const value = record[key];
    if (typeof value === "string" && isHttpUrl(value)) return value;
  }
  return null;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}
