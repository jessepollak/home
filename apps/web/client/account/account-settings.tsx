"use client";

import { Fragment, type ReactNode } from "react";
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
import { formatAddress } from "@/shared/formatting";
import {
  BORROW_COLLATERAL_TOKEN,
  BORROW_LOAN_TOKEN,
  BORROW_MARKET_ID,
  BORROW_ORACLE_ADDRESS,
  MORPHO_BLUE_ADDRESS,
} from "@/shared/borrowing/config";
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
  onSignOut,
}: {
  regionId: RegionId;
  onRegionChange: (regionId: RegionId) => void;
  resolutionSource: ResolutionSource;
  preferenceMessage: string;
  isPreferenceReady: boolean;
  accountAddress: string | null;
  onSignOut: () => void;
}) {
  const region = presentationRegions[regionId];

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
                <ItemDescription id="country-help" className="line-clamp-none">
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
              <li>
                <Item>
                  <ItemContent>
                    <ItemTitle className="font-normal text-muted-foreground">Base account</ItemTitle>
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
          <CardContent className="px-2">
            <ul className="m-0 list-none p-0">
              <DisclosureRows />
            </ul>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function DisclosureRows() {
  const rows = [
    <DisclosureRow key="availability" title="Availability">
      Features and providers vary by country. Tokenized stock trading requires
      issuer and provider eligibility verification.
    </DisclosureRow>,
    <DisclosureRow key="providers" title="Providers and issuers">
      Home shows assets and services from third-party providers and issuers,
      including Coinbase, Ripio, Morpho, and Circle. A listing is not an
      endorsement.
    </DisclosureRow>,
    <DisclosureRow key="data" title="Data sources">
      Market prices come from Codex. Savings rates and vault data come from
      Morpho. Borrow market data comes from Base RPC.
    </DisclosureRow>,
    <DisclosureRow key="market" title="Borrow market">
      <span>
        Morpho Blue market{" "}
        <CopyableValue value={BORROW_MARKET_ID} display={formatAddress(BORROW_MARKET_ID)} valueKind="market ID" />{" "}
        on Base: Morpho{" "}
        <CopyableValue value={MORPHO_BLUE_ADDRESS} display={formatAddress(MORPHO_BLUE_ADDRESS)} valueKind="address" />
        , cbBTC{" "}
        <CopyableValue value={BORROW_COLLATERAL_TOKEN.address} display={formatAddress(BORROW_COLLATERAL_TOKEN.address)} valueKind="address" />
        , USDC{" "}
        <CopyableValue value={BORROW_LOAN_TOKEN.address} display={formatAddress(BORROW_LOAN_TOKEN.address)} valueKind="address" />
        , oracle{" "}
        <CopyableValue value={BORROW_ORACLE_ADDRESS} display={formatAddress(BORROW_ORACLE_ADDRESS)} valueKind="address" />.
      </span>
    </DisclosureRow>,
    <DisclosureRow key="terms" title="Terms">
      <span className="flex flex-wrap gap-x-3 gap-y-2">
        <a className="font-medium text-primary" href="https://www.coinbase.com/legal" target="_blank" rel="noreferrer">Coinbase legal</a>
        <a className="font-medium text-primary" href="https://terms.ripio.com/" target="_blank" rel="noreferrer">Ripio terms</a>
        <a className="font-medium text-primary" href="https://morpho.org/terms-of-use/" target="_blank" rel="noreferrer">Morpho terms</a>
      </span>
    </DisclosureRow>,
  ];

  return rows.map((row, index) => (
    <Fragment key={row.key}>
      {index > 0 ? (
        <li aria-hidden="true">
          <ItemSeparator className="my-0" />
        </li>
      ) : null}
      {row}
    </Fragment>
  ));
}

function DisclosureRow({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Item render={<li />} className="min-w-0">
      <ItemContent className="min-w-0">
        <ItemTitle>{title}</ItemTitle>
        <ItemDescription className="min-w-0 line-clamp-none text-sm text-muted-foreground [overflow-wrap:anywhere] [&_button]:h-auto [&_button]:min-h-11 [&_button]:max-w-full [&_button]:whitespace-normal [&_button]:break-all">
          {children}
        </ItemDescription>
      </ItemContent>
    </Item>
  );
}
