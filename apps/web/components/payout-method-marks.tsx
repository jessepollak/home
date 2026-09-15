type PayoutMethod = {
  id: string;
  label: string;
  platform: string;
};

type PayoutMarkVariant = "cashapp" | "zelle" | "monzo" | "revolut" | "fallback";

const MARK_STYLES: Record<PayoutMarkVariant, string> = {
  cashapp: "bg-[#00d64f] text-black",
  zelle: "bg-[#6d1ed4] text-white",
  monzo: "bg-[#14233c] text-white",
  revolut: "bg-black text-white",
  fallback: "bg-muted text-foreground",
};

export function PayoutMethodMarks({ methods }: { methods: ReadonlyArray<PayoutMethod> }) {
  const visible = methods.slice(0, 4);
  const labels = methods.map((method) => method.label).join(", ");
  return <span className="flex -space-x-2" role="img" aria-label={`Available payout apps: ${labels}`}>
    {visible.map((method) => {
      const mark = payoutMark(method.platform, method.label);
      return <span key={method.id} className={`relative flex size-7 items-center justify-center rounded-full border-2 border-background text-xs font-bold ${MARK_STYLES[mark.variant]}`} aria-hidden="true">{mark.text}</span>;
    })}
    {methods.length > visible.length ? <span className="relative flex size-7 items-center justify-center rounded-full border-2 border-background bg-muted text-xs font-medium text-muted-foreground" aria-hidden="true">+{methods.length - visible.length}</span> : null}
  </span>;
}

function payoutMark(platform: string, label: string): { text: string; variant: PayoutMarkVariant } {
  switch (platform.toLowerCase()) {
    case "cashapp": return { text: "$", variant: "cashapp" };
    case "zelle": return { text: "Z", variant: "zelle" };
    case "monzo": return { text: "M", variant: "monzo" };
    case "revolut": return { text: "R", variant: "revolut" };
    default: return { text: label.trim().charAt(0).toUpperCase() || "?", variant: "fallback" };
  }
}
