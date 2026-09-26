import type { RefObject } from "react";
import { Button } from "@/components/ui/button";

export type TradeAvailability = "available" | "available-no-holding" | "signed-out" | "temporarily-unavailable" | "not-set-up" | "unsupported-signer" | "stock-not-yet-in-home";

export function TradeEntry({ availability, holding, onBuy, onSell, buyButtonRef, sellButtonRef, onSignIn, onRetry }: {
  availability: TradeAvailability;
  holding: string;
  onBuy?: () => void;
  onSell?: () => void;
  buyButtonRef?: RefObject<HTMLButtonElement | null>;
  sellButtonRef?: RefObject<HTMLButtonElement | null>;
  onSignIn?: () => void;
  onRetry?: () => void;
}) {
  return (
    <section className="sticky bottom-[env(safe-area-inset-bottom)] z-2 mt-4 space-y-2 bg-transparent pt-3" aria-label="Trade Bitcoin">
      {availability === "available" || availability === "available-no-holding" ? (
        <>
          <p className="text-sm text-foreground">{availability === "available" ? <>You have <span className="whitespace-nowrap font-medium tabular-nums">{holding} cbBTC</span></> : "No Bitcoin to sell yet"}</p>
          <div className="grid grid-cols-2 gap-2">
            <Button ref={buyButtonRef} size="lg" className="h-11" onClick={onBuy}>Buy</Button>
            <Button ref={sellButtonRef} size="lg" className="h-11" variant="secondary" disabled={availability === "available-no-holding"} onClick={onSell}>Sell</Button>
          </div>
        </>
      ) : availability === "signed-out" ? <Button size="lg" className="h-11 w-full" onClick={onSignIn}>Sign in to continue</Button>
        : availability === "temporarily-unavailable" ? <div role="status" className="space-y-2 text-sm"><p className="font-medium text-foreground">Temporarily unavailable</p><p className="text-muted-foreground">Home could not load trading.</p><Button size="lg" className="h-11 w-full" onClick={onRetry}>Try again</Button></div>
          : <div role="status" className="space-y-1 text-sm"><p className="font-medium text-foreground">{availability === "not-set-up" ? "This feature is not set up" : availability === "unsupported-signer" ? "Your wallet can't trade in Home yet." : "Stock trading is not yet in Home."}</p></div>}
    </section>
  );
}
