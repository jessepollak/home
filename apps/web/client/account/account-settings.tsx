"use client";

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
        <h2 id="preferences-heading" className={styles.kicker}>
          Preferences
        </h2>
        <div className={styles.card}>
          <div className={styles.countryRow}>
            <CurrencyMark
              currency={region.currency.code}
              symbol={region.currency.symbol}
            />
            <div className={styles.countryCopy}>
              <span>Country</span>
              <p id="country-help">Sets how money is shown</p>
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
        <h2 id="account-heading" className={styles.kicker}>
          Account
        </h2>
        <div className={styles.card}>
          <div className={styles.row}>
            <div>
              <strong>Base account</strong>
              <small>
                {accountAddress ? (
                  <CopyableValue
                    value={accountAddress}
                    display={formatAddress(accountAddress)}
                    valueKind="address"
                  />
                ) : (
                  "Setup in progress"
                )}
              </small>
            </div>
          </div>
          <button className={styles.rowButton} type="button" onClick={onSignOut}>
            <span>Sign out</span>
            <ChevronIcon />
          </button>
        </div>
      </section>
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
