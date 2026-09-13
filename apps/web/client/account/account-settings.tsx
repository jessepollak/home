"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
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
import styles from "./account-settings.module.css";

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
    <div className={styles.page}>
      <section className={styles.section} aria-labelledby="preferences-heading">
        <h2 id="preferences-heading" className="text-section-title font-semibold">
          Preferences
        </h2>
        <ul className={styles.card}>
          <Item render={<li />} className={styles.countryRow}>
            <ItemMedia>
              <CurrencyMark
                currency={region.currency.code}
                symbol={region.currency.symbol}
              />
            </ItemMedia>
            <ItemContent>
              <ItemTitle className="text-row-label!">Country</ItemTitle>
              <ItemDescription id="country-help" className="line-clamp-none text-metadata!">
                Sets how money is shown
              </ItemDescription>
            </ItemContent>
            <ItemActions className={styles.countryAction}>
              <CountrySelect
                value={regionId}
                onValueChange={onRegionChange}
                describedBy="country-help preference-status"
                variant="settings"
              />
            </ItemActions>
          </Item>
        </ul>
        <Alert id="preference-status" aria-live="polite" role="status" className="sr-only">
          <AlertDescription>
            {preferenceMessage ||
              (isPreferenceReady
                ? `${sourceLabels[resolutionSource]}.`
                : "Checking saved country preference.")}
          </AlertDescription>
        </Alert>
      </section>

      <section className={styles.section} aria-labelledby="account-heading">
        <h2 id="account-heading" className="text-section-title font-semibold">
          Account
        </h2>
        <ul className={styles.card}>
          <Item render={<li />} className={styles.contentRow}>
            <ItemContent>
              <ItemTitle className="text-row-label!">Base account</ItemTitle>
              <ItemDescription className="text-metadata!">
                {accountAddress ? (
                  <CopyableValue
                    value={accountAddress}
                    display={formatAddress(accountAddress)}
                    valueKind="address"
                  />
                ) : (
                  "Setup in progress"
                )}
              </ItemDescription>
            </ItemContent>
          </Item>
          <li>
            <Item
              render={<Button variant="ghost" />}
              className={styles.actionRow}
              onClick={onSignOut}
              aria-describedby="sign-out-hint"
            >
              <ItemContent>
                <ItemTitle className="text-row-label!">Sign out</ItemTitle>
              </ItemContent>
              <ItemActions aria-hidden="true">
                <ChevronRight />
              </ItemActions>
              <span id="sign-out-hint" hidden>Sign out of Home</span>
            </Item>
          </li>
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="disclosures-heading">
        <h2 id="disclosures-heading" className="text-section-title font-semibold">
          Disclosures &amp; terms
        </h2>
        <ul className={styles.card}>
          <DisclosureRow title="Availability">
            Features and providers vary by country. Tokenized stock trading
            requires issuer and provider eligibility verification.
          </DisclosureRow>
          <DisclosureRow title="Providers and issuers">
            Home shows assets and services from third-party providers and
            issuers, including Coinbase, Ripio, Morpho, and Circle. A listing
            is not an endorsement.
          </DisclosureRow>
          <DisclosureRow title="Data sources">
            Market prices come from Codex. Savings rates and vault data come
            from Morpho. Borrow market data comes from Base RPC.
          </DisclosureRow>
          <DisclosureRow title="Borrow market">
            <span className={styles.contracts}>
              Morpho Blue market{" "}
              <CopyableValue
                value={BORROW_MARKET_ID}
                display={formatAddress(BORROW_MARKET_ID)}
                valueKind="market ID"
              />{" "}
              on Base: Morpho{" "}
              <CopyableValue
                value={MORPHO_BLUE_ADDRESS}
                display={formatAddress(MORPHO_BLUE_ADDRESS)}
                valueKind="address"
              />
              , cbBTC{" "}
              <CopyableValue
                value={BORROW_COLLATERAL_TOKEN.address}
                display={formatAddress(BORROW_COLLATERAL_TOKEN.address)}
                valueKind="address"
              />
              , USDC{" "}
              <CopyableValue
                value={BORROW_LOAN_TOKEN.address}
                display={formatAddress(BORROW_LOAN_TOKEN.address)}
                valueKind="address"
              />
              , oracle{" "}
              <CopyableValue
                value={BORROW_ORACLE_ADDRESS}
                display={formatAddress(BORROW_ORACLE_ADDRESS)}
                valueKind="address"
              />
              .
            </span>
          </DisclosureRow>
          <DisclosureRow title="Terms">
            <span className={styles.termLinks}>
              <a href="https://www.coinbase.com/legal" target="_blank" rel="noreferrer">
                Coinbase legal
              </a>
              <a href="https://terms.ripio.com/" target="_blank" rel="noreferrer">
                Ripio terms
              </a>
              <a href="https://morpho.org/terms-of-use/" target="_blank" rel="noreferrer">
                Morpho terms
              </a>
            </span>
          </DisclosureRow>
        </ul>
      </section>
    </div>
  );
}

function DisclosureRow({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Item render={<li />} className={`${styles.contentRow} ${styles.disclosureRow}`}>
      <ItemContent>
        <ItemTitle className="text-row-label!">{title}</ItemTitle>
        <ItemDescription className="line-clamp-none text-metadata!">{children}</ItemDescription>
      </ItemContent>
    </Item>
  );
}
