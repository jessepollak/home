"use client";

import { Button, Heading, Text } from "@home/ui";
import { ArrowRightIcon } from "@home/ui/icons";
import { CopyableValue } from "@/components/copyable-value";
import { CountrySelect } from "@/components/country-select";
import { CurrencyMark } from "@/components/currency-mark";
import { formatAddress } from "@/shared/formatting";
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
        <Heading
          id="preferences-heading"
          level={2}
          textStyle="section-title"
        >
          Preferences
        </Heading>
        <div className={styles.card}>
          <div className={styles.countryRow}>
            <CurrencyMark
              currency={region.currency.code}
              symbol={region.currency.symbol}
            />
            <div className={styles.countryCopy}>
              <Text as="span" textStyle="row-label">
                Country
              </Text>
              <Text
                id="country-help"
                textStyle="metadata"
                tone="muted"
              >
                Sets how money is shown
              </Text>
            </div>
            <CountrySelect
              value={regionId}
              onValueChange={onRegionChange}
              describedBy="country-help preference-status"
              variant="settings"
            />
          </div>
        </div>
        <p id="preference-status" className="sr-status" aria-live="polite">
          {preferenceMessage ||
            (isPreferenceReady
              ? `${sourceLabels[resolutionSource]}.`
              : "Checking saved country preference.")}
        </p>
      </section>

      <section className={styles.section} aria-labelledby="account-heading">
        <Heading id="account-heading" level={2} textStyle="section-title">
          Account
        </Heading>
        <div className={styles.card}>
          <div className={styles.row}>
            <div>
              <Text as="strong" textStyle="row-label">
                Base account
              </Text>
              <Text as="small" textStyle="metadata" tone="muted">
                {accountAddress ? (
                  <CopyableValue
                    value={accountAddress}
                    display={formatAddress(accountAddress)}
                    valueKind="address"
                  />
                ) : (
                  "Setup in progress"
                )}
              </Text>
            </div>
          </div>
          <Button
            className={styles.rowButton}
            variant="quiet"
            onClick={onSignOut}
          >
            <span className={styles.rowButtonContent}>
              <Text as="span" textStyle="row-label">
                Sign out
              </Text>
              <ArrowRightIcon
                size={20}
                weight="regular"
                aria-hidden="true"
                focusable="false"
              />
            </span>
          </Button>
        </div>
      </section>
    </div>
  );
}
