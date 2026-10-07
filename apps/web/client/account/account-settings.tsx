"use client";

import { useState, useSyncExternalStore } from "react";
import { LogOut } from "lucide-react";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { useAccountExport } from "@/client/account/use-account-export";
import { useInviteLink } from "@/client/account/use-invite-link";
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
import { RadioGroup, RadioGroupSegment } from "@/components/ui/radio-group";
import { supportUnreadLabel } from "@/components/profile-mark";
import { CopyableValue } from "@/components/copyable-value";
import { CountrySelect } from "@/components/country-select";
import { CurrencyMark } from "@/components/currency-mark";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useBasenameProfile } from "@/client/account/use-basename-profile";
import { useOptionalSupport } from "@/client/support/support-provider";
import type { AppearancePreference } from "@/shared/appearance/preference";
import {
  presentationRegions,
  type CountryCode,
  type RegionId,
  type ResolutionSource,
} from "@/config/regions";

const sourceLabels: Record<ResolutionSource, string> = {
  explicit: "Your country choice",
  persisted: "Saved country",
  detected: "Country from your location",
  fallback: "Default country",
};

function subscribeShare() {
  return () => {};
}

function shareSnapshot() {
  return typeof navigator.share === "function";
}

function serverShareSnapshot() {
  return false;
}

function InviteLinkControl({ url }: { url: string }) {
  const [shareError, setShareError] = useState(false);
  const canShare = useSyncExternalStore(subscribeShare, shareSnapshot, serverShareSnapshot);

  async function shareLink(): Promise<"shared" | "cancelled" | "failed"> {
    setShareError(false);
    try {
      await navigator.share({ title: "Home", url });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      setShareError(true);
      return "failed";
    }
  }

  return (
    <>
      <ItemContent className="min-w-0 flex-1">
        <div dir="ltr">
          <CopyableValue
            value={url}
            display={url.replace(/^https?:\/\//, "")}
            presentation="compact"
            valueKind="invite link"
            copyLabelPrefix="Copy invite link "
          />
        </div>
        {shareError ? (
          <ItemDescription role="status">Couldn&apos;t share your invite link.</ItemDescription>
        ) : null}
      </ItemContent>
      {canShare ? (
        <ItemActions className="flex-wrap">
          <Button variant="outline" size="touch" aria-label="Share invite link" onClick={() => void shareLink()}>
            Share
          </Button>
        </ItemActions>
      ) : null}
    </>
  );
}

export function AccountSettings({
  regionId,
  onRegionChange,
  offeredCountries,
  resolutionSource,
  preferenceMessage,
  isPreferenceReady,
  accountAddress,
  accountOwnerKey = null,
  fetchAccountResource,
  showSmallBalances,
  onShowSmallBalancesChange,
  appearancePreference,
  onAppearancePreferenceChange,
  onSignOut,
}: {
  regionId: RegionId;
  onRegionChange: (regionId: RegionId) => void;
  offeredCountries?: readonly CountryCode[];
  resolutionSource: ResolutionSource;
  preferenceMessage: string;
  isPreferenceReady: boolean;
  accountAddress: string | null;
  accountOwnerKey?: string | null;
  fetchAccountResource: AccountWalletClient["fetchAccountResource"];
  showSmallBalances: boolean;
  onShowSmallBalancesChange: (value: boolean) => void;
  appearancePreference: AppearancePreference;
  onAppearancePreferenceChange: (value: AppearancePreference) => boolean;
  onSignOut: () => void;
}) {
  const [appearanceMessage, setAppearanceMessage] = useState("");
  const support = useOptionalSupport();
  const region = presentationRegions[regionId];
  const basenameProfile = useBasenameProfile({
    ownerKey: accountOwnerKey,
    address: accountAddress,
  });
  const basename = basenameProfile.data?.name ?? null;
  const inviteLink = useInviteLink({
    ownerKey: accountAddress ? accountOwnerKey : null,
    fetchAccountResource,
  });
  const inviteUrl = inviteLink.data;
  const accountExport = useAccountExport({ ownerKey: accountOwnerKey, fetchAccountResource });

  return (
    <div className="min-w-0 space-y-8 py-2 pb-6">
      <section className="space-y-3" aria-labelledby="preferences-heading">
        <h2 id="preferences-heading" className="text-lg font-semibold">
          Preferences
        </h2>
        <Card>
          <CardContent inset="list">
            <Item className="min-w-0 flex-nowrap items-center">
              <ItemMedia className="self-center translate-y-0">
                <CurrencyMark
                  currency={region.currency.code}
                  symbol={region.currency.symbol}
                />
              </ItemMedia>
              <ItemContent className="min-w-0 flex-1">
                <ItemTitle>Country</ItemTitle>
                <ItemDescription id="country-help">
                  Sets how money is shown
                </ItemDescription>
              </ItemContent>
              <ItemActions className="min-w-0 shrink justify-end">
                <CountrySelect
                  value={regionId}
                  onValueChange={onRegionChange}
                  offered={offeredCountries}
                  describedBy="country-help preference-status"
                  variant="settings"
                />
              </ItemActions>
            </Item>
            <ItemSeparator className="my-0" />
            <Item className="min-w-0 flex-wrap items-center">
              <ItemContent className="min-w-0 flex-1">
                <ItemTitle id="appearance-title">Appearance</ItemTitle>
              </ItemContent>
              <ItemActions className="min-w-0 w-full basis-full sm:w-auto sm:basis-auto">
                <RadioGroup
                  variant="segmented"
                  className="sm:w-auto"
                  aria-labelledby="appearance-title"
                  aria-describedby="appearance-status"
                  value={appearancePreference}
                  onValueChange={(value) => {
                    const persisted = onAppearancePreferenceChange(value as AppearancePreference);
                    setAppearanceMessage(persisted ? "" : "Appearance updated for this visit. Browser storage is unavailable.");
                  }}
                >
                  <RadioGroupSegment value="light">Light</RadioGroupSegment>
                  <RadioGroupSegment value="dark">Dark</RadioGroupSegment>
                  <RadioGroupSegment value="system">System</RadioGroupSegment>
                </RadioGroup>
              </ItemActions>
            </Item>
            <ItemSeparator className="my-0" />
            <Item className="min-w-0 flex-nowrap items-center">
              <ItemContent className="min-w-0 flex-1">
                <ItemTitle>Show small balances</ItemTitle>
              </ItemContent>
              <ItemActions>
                <Switch
                  checked={showSmallBalances}
                  onCheckedChange={onShowSmallBalancesChange}
                  aria-label="Show small balances"
                />
              </ItemActions>
            </Item>
          </CardContent>
        </Card>
        <Alert id="appearance-status" aria-live="polite" role="status" className="sr-only">
          <AlertDescription>{appearanceMessage}</AlertDescription>
        </Alert>
        <Alert id="preference-status" aria-live="polite" role="status" className="sr-only">
          <AlertDescription>
            {preferenceMessage ||
              (isPreferenceReady
                ? `${sourceLabels[resolutionSource]}.`
                : "Checking saved country preference.")}
          </AlertDescription>
        </Alert>
      </section>

      {support ? (
        <section className="space-y-3" aria-labelledby="support-heading">
          <h2 id="support-heading" className="text-lg font-semibold">
            Support
          </h2>
          <Card>
            <CardContent inset="list">
              <Item className="min-w-0">
                <ItemContent className="min-w-0">
                  <ItemTitle>Support</ItemTitle>
                  <ItemDescription>{support.summaryStatus === "checking" ? "Checking messages" : "Message us"}</ItemDescription>
                </ItemContent>
                {support.unreadCount !== null && support.unreadCount > 0 ? (
                  <ItemActions>
                    <span className="text-sm text-muted-foreground tabular-nums">{support.unreadCount} unread{support.summaryFailed ? " · may be out of date" : ""}</span>
                  </ItemActions>
                ) : null}
              </Item>
              <Item>
                <ItemContent className="min-w-0">
                  <Button
                    variant="outline"
                    size="touch"
                    className="w-full justify-start"
                    aria-label={supportUnreadLabel("Support", support.unreadCount, support.summaryStatus)}
                    onClick={() => support.openSupport()}
                  >
                    Message support
                  </Button>
                </ItemContent>
              </Item>
              {support.summaryFailed ? (
                <Item>
                  <ItemContent className="min-w-0">
                    <ItemDescription>Couldn&apos;t check messages</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button variant="outline" size="touch" onClick={support.retrySummary} aria-label="Retry checking support messages">
                      Retry
                    </Button>
                  </ItemActions>
                </Item>
              ) : null}
            </CardContent>
          </Card>
        </section>
      ) : null}

      <section className="space-y-3" aria-labelledby="account-heading">
        <h2 id="account-heading" className="text-lg font-semibold">
          Account
        </h2>
        <Card>
          <CardContent inset="list">
            <ul className="m-0 list-none p-0">
              <li className="min-w-0">
                <Item className="min-w-0">
                  <ItemContent className="min-w-0">
                    {accountAddress && basenameProfile.isPending ? (
                      <Skeleton className="h-4 w-28" role="status" aria-label="Loading Basename" />
                    ) : (
                      <ItemTitle tone={basename ? "default" : "muted"}>
                        {basename ? basename : <span className="font-normal">Base account</span>}
                      </ItemTitle>
                    )}
                    {accountAddress ? (
                      <CopyableValue
                        value={accountAddress}
                        presentation="reveal"
                        valueKind="address"
                      />
                    ) : (
                      <ItemDescription>Setup in progress</ItemDescription>
                    )}
                  </ItemContent>
                </Item>
              </li>
              <li className="px-3 py-2.5">
                <Button
                  variant="outline"
                  size="touch"
                  className="w-full justify-start"
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

      {accountAddress && accountOwnerKey && (inviteLink.isPending || inviteLink.isError || inviteUrl) ? (
        <section className="space-y-3" aria-labelledby="invites-heading">
          <h2 id="invites-heading" className="text-lg font-semibold">
            Invite friends
          </h2>
          <Card>
            <CardContent inset="list">
              <Item className="min-w-0 flex-wrap">
                {inviteUrl && !inviteLink.isPending && !inviteLink.isError ? (
                  <InviteLinkControl key={inviteUrl} url={inviteUrl} />
                ) : (
                  <ItemContent className="min-w-0">
                    {inviteLink.isPending ? (
                      <Skeleton className="h-5 w-full" role="status" aria-label="Loading invite link" />
                    ) : inviteLink.isError ? (
                      <>
                        <ItemDescription>Couldn&apos;t load your invite link.</ItemDescription>
                        <ItemActions>
                          <Button variant="outline" size="touch" onClick={() => void inviteLink.refetch()}>
                            Try again
                          </Button>
                        </ItemActions>
                      </>
                    ) : null}
                  </ItemContent>
                )}
              </Item>
            </CardContent>
          </Card>
        </section>
      ) : null}

      {accountOwnerKey ? (
        <section className="space-y-3" aria-labelledby="your-data-heading">
          <h2 id="your-data-heading" className="text-lg font-semibold">
            Your data
          </h2>
          <Card>
            <CardContent inset="list">
              <Item className="min-w-0 flex-wrap">
                <ItemContent className="min-w-0 flex-1">
                  <ItemTitle>Export my data</ItemTitle>
                  <ItemDescription>
                    {accountExport.state === "error"
                      ? "Couldn't create your export. Nothing in your account changed."
                      : "Download a copy of your Home data"}
                  </ItemDescription>
                  <ItemDescription role="status" aria-live="polite">
                    {accountExport.state === "generating" ? "Preparing your export"
                      : accountExport.state === "success" ? "Export downloaded" : ""}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    variant="outline"
                    size="touch"
                    disabled={accountExport.state === "generating"}
                    aria-busy={accountExport.state === "generating"}
                    onClick={() => void accountExport.start()}
                  >
                    {accountExport.state === "generating" ? "Preparing…"
                      : accountExport.state === "error" ? "Try again" : "Export"}
                  </Button>
                </ItemActions>
              </Item>
            </CardContent>
          </Card>
        </section>
      ) : null}

      <section className="space-y-3" aria-labelledby="disclosures-heading">
        <h2 id="disclosures-heading" className="text-lg font-semibold">
          Disclosures &amp; terms
        </h2>
        <Card>
          <CardContent>
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
            <p className="mt-2 text-sm text-muted-foreground">
              Stock prices are{" "}
              <a className="font-medium text-primary" href="https://docs.chain.link/data-feeds/tokenized-equity-feeds/coinbase" target="_blank" rel="noreferrer">
                Chainlink reference prices
              </a>.{" "}
              <a className="font-medium text-primary" href="https://www.base.org/stocks" target="_blank" rel="noreferrer">
                Tokenized stock roster
              </a>{" "}
              ·{" "}
              <a className="font-medium text-primary" href="https://www.coinbase.com/cbbtc" target="_blank" rel="noreferrer">
                Coinbase wrapped assets
              </a>
            </p>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
