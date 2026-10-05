import type { ReactNode } from "react";
import { AccountWalletClientProvider, type AccountWalletClient } from "@/client/account/cdp-client";
import type { HomeAssetBalancesPresentation, ShellSearchContentProps } from "@/client/home/home-types";
import { ProductOfferingProvider } from "@/client/home/product-offering";
import { DashboardShell, type DashboardShellProps } from "@/client/home/shell";
import { AssetSearch } from "@/client/invest/asset-search";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { resolveProductOffering } from "@/shared/operator-settings/products";
import { investLogoResolution } from "@/stories/review/explorations/library/invest-logos";
import { balance, homeShellHandlers, wallet } from "./home-pull-to-refresh.fixtures";
import { createAssetDetailClient } from "./invest-asset-detail-fixture";
import { availableAssets, sendRecipientHandlers } from "./send-recipient.fixtures";

const offering = resolveProductOffering({ kind: "deployment" });
const region: DashboardShellProps["region"] = {
  regionId: "US", resolutionSource: "persisted", isPreferenceReady: true, preferenceMessage: "",
  selectRegion: () => {}, offeredCountries: ["US"],
};

export const compositionWallet: AccountWalletClient = { ...wallet, fetchBalances: createAssetDetailClient().fetchBalances };
export const compositionShellHandlers = [...homeShellHandlers, ...sendRecipientHandlers];

const renderSearchContent = (props: ShellSearchContentProps) => <AssetSearch {...props} assetMarkResolution={investLogoResolution} />;

export function CompositionShell({ assetBalances = balance, investContent, children }: {
  assetBalances?: HomeAssetBalancesPresentation;
  investContent?: ReactNode;
  children: ReactNode;
}) {
  return <AccountWalletClientProvider client={compositionWallet}>
    <ProductOfferingProvider value={offering}>
      <PresentationRegionProvider regionId="US">
        <DashboardShell cardsEnabled searchContent={renderSearchContent} investContent={investContent}
          assetBalances={assetBalances} sendAvailability={availableAssets} region={region}>
          {children}
        </DashboardShell>
      </PresentationRegionProvider>
    </ProductOfferingProvider>
  </AccountWalletClientProvider>;
}
