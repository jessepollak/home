export function canonicalizeCashPayee(platform: string, value: string): string {
  const trimmed = value.trim();
  if (platform === "cashapp") return trimmed.replace(/^\$+/, "");
  if (platform === "zelle") return trimmed.toLowerCase();
  return trimmed;
}

export function cashPayeeLabels(platform: string, label: string): { field: string; noun: string } {
  switch (platform) {
    case "cashapp": return { field: "Cash App cashtag", noun: "Cashtag" };
    case "zelle": return { field: "Zelle email or phone", noun: "Email or phone" };
    case "revolut": return { field: "Revolut Revtag", noun: "Revtag" };
    case "monzo": return { field: "Monzo username", noun: "Username" };
    default: return { field: `${label} handle`, noun: "Handle" };
  }
}
