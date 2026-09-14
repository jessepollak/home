"use client";

import { LogOut } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { CopyableValue } from "@/components/copyable-value";
import { CountrySelect } from "@/components/country-select";
import { CurrencyMark } from "@/components/currency-mark";
import { Skeleton } from "@/components/ui/skeleton";
import { useBasenameProfile } from "@/client/account/use-basename-profile";
import {
  presentationRegions,
  type RegionId,
  type ResolutionSource,
} from "@/config/regions";

const sourceLabels: Record<ResolutionSource, string> = {
  explicit: "Your country choice",
  persisted: "Saved country choice",
  detected: "Suggested country",
  fallback: "No country selected",
};

export function AccountSettings({
  regionId,
  onRegionChange,
  resolutionSource,
  preferenceMessage,
  isPreferenceReady,
  accountAddress,
  accountOwnerKey = null,
  showSmallBalances,
  onShowSmallBalancesChange,
  onSignOut,
}: {
  regionId: RegionId;
  onRegionChange: (regionId: RegionId) => void;
  resolutionSource: ResolutionSource;
  preferenceMessage: string;
  isPreferenceReady: boolean;
  accountAddress: string | null;
  accountOwnerKey?: string | null;
  showSmallBalances: boolean;
  onShowSmallBalancesChange: (value: boolean) => void;
  onSignOut: () => void;
}) {
  const region = presentationRegions[regionId];
  const basenameProfile = useBasenameProfile({
    ownerKey: accountOwnerKey,
    address: accountAddress,
  });
  const basename = basenameProfile.data?.name ?? null;

  return (
    <div className="min-w-0 space-y-8 py-2 pb-6">
      <section className="space-y-3" aria-labelledby="preferences-heading">
        <h2 id="preferences-heading" className="text-lg font-semibold">
          Preferences
        </h2>
        <Card>
          <CardContent className="px-2">
            <Item className="min-w-0 flex-nowrap items-center">
              <ItemMedia className="self-center translate-y-0">
                <CurrencyMark
                  currency={region.currency.code}
                  symbol={region.currency.symbol}
                />
              </ItemMedia>
              <ItemContent className="min-w-0 flex-1">
                <ItemTitle>Country</ItemTitle>
                <ItemDescription id="country-help" className="line-clamp-1">
                  Sets how money is shown
                </ItemDescription>
              </ItemContent>
              <ItemActions className="min-w-0 shrink justify-end">
                <CountrySelect
                  value={regionId}
                  onValueChange={onRegionChange}
                  describedBy="country-help preference-status"
                  variant="settings"
                />
              </ItemActions>
            </Item>
            <ItemSeparator className="my-0" />
            <Item className="min-w-0 flex-nowrap items-center">
              <ItemContent className="min-w-0 flex-1">
                <ItemTitle>Show small balances</ItemTitle>
              </ItemContent>
              <ItemActions>
                <Button
                  type="button"
                  variant="ghost"
                  role="switch"
                  aria-checked={showSmallBalances}
                  aria-label="Show small balances"
                  className="relative h-7 w-12 rounded-full bg-muted p-0 transition-colors aria-checked:bg-primary"
                  onClick={() => onShowSmallBalancesChange(!showSmallBalances)}
                >
                  <span
                    aria-hidden="true"
                    className="absolute left-1 top-1 size-5 rounded-full bg-background shadow-sm transition-transform aria-hidden:translate-x-0"
                    style={{ transform: showSmallBalances ? "translateX(1.25rem)" : undefined }}
                  />
                </Button>
              </ItemActions>
            </Item>
          </CardContent>
        </Card>
        <Alert id="preference-status" aria-live="polite" role="status" className="sr-only">
          <AlertDescription>
            {preferenceMessage ||
              (isPreferenceReady
                ? `${sourceLabels[resolutionSource]}.`
                : "Checking saved country preference.")}
          </AlertDescription>
        </Alert>
      </section>

      <section className="space-y-3" aria-labelledby="account-heading">
        <h2 id="account-heading" className="text-lg font-semibold">
          Account
        </h2>
        <Card>
          <CardContent className="px-2">
            <ul className="m-0 list-none p-0">
              <li className="min-w-0">
                <Item className="min-w-0">
                  <ItemContent className="min-w-0">
                    {accountAddress && basenameProfile.isPending ? (
                      <Skeleton className="h-4 w-28" aria-label="Loading Basename" />
                    ) : (
                      <ItemTitle className={basename ? undefined : "font-normal text-muted-foreground"}>
                        {basename ?? "Base account"}
                      </ItemTitle>
                    )}
                    <ItemDescription className="line-clamp-none text-foreground">
                      {accountAddress ? (
                        <CopyableValue
                          value={accountAddress}
                          presentation="full"
                          valueKind="address"
                        />
                      ) : (
                        "Setup in progress"
                      )}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              </li>
              <li className="px-3 py-2.5">
                <Button
                  variant="outline"
                  className="h-11 w-full justify-start"
                  onClick={onSignOut}
                  aria-describedby="sign-out-hint"
                >
                  <LogOut className="size-4" aria-hidden="true" />
                  Sign out
                </Button>
                <span id="sign-out-hint" hidden>Sign out of Home</span>
              </li>
            </ul>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3" aria-labelledby="disclosures-heading">
        <h2 id="disclosures-heading" className="text-lg font-semibold">
          Disclosures &amp; terms
        </h2>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">
              Features and providers vary by country.{" "}
              <a className="font-medium text-primary" href="https://terms.ripio.com/" target="_blank" rel="noreferrer">
                Ripio terms
              </a>{" "}
              ·{" "}
              <a className="font-medium text-primary" href="https://morpho.org/terms-of-use/" target="_blank" rel="noreferrer">
                Morpho terms
              </a>
            </p>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
