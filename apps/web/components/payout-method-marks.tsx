import { PayoutMark, type PayoutMarkVariant } from "@/components/ui/payout-mark";

type PayoutMethod = {
  id: string;
  label: string;
  platform: string;
};

export function PayoutMethodMarks({ methods }: { methods: ReadonlyArray<PayoutMethod> }) {
  const visible = methods.slice(0, 4);
  const labels = methods.map((method) => method.label).join(", ");
  const hiddenCount = methods.length - visible.length;
  return <span className="flex -space-x-2" role="img" aria-label={`Available payout apps: ${labels}`}>
    {visible.map((method) => {
      const mark = payoutMark(method.platform, method.label);
      return <PayoutMark key={method.id} variant={mark.variant} className="relative">{mark.text}</PayoutMark>;
    })}
    {hiddenCount > 0 ? <PayoutMark variant="count" className="relative">+{hiddenCount}</PayoutMark> : null}
  </span>;
}

// Platform-to-glyph data stays product data; presentation lives in the owned
// PayoutMark variants.
function payoutMark(platform: string, label: string): { text: string; variant: PayoutMarkVariant } {
  switch (platform.toLowerCase()) {
    case "cashapp": return { text: "$", variant: "cashapp" };
    case "zelle": return { text: "Z", variant: "zelle" };
    case "monzo": return { text: "M", variant: "monzo" };
    case "revolut": return { text: "R", variant: "revolut" };
    default: return { text: label.trim().charAt(0).toUpperCase() || "?", variant: "fallback" };
  }
}
