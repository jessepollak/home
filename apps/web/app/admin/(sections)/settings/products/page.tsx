import { BORROW_MARKETS } from "@/shared/borrowing/config";
import { VERIFIED_SAVE_VAULTS } from "@/shared/savings/config";
import { productCatalog } from "@/shared/operator-settings/products";
import { readOperatorPageDecision } from "@/server/operator/page";
import { readProductSettingsEntryForPage, type ProductSettingsEntry } from "@/server/operator-settings/products";
import { ProductSettingsEditor, ProductSettingsLoadError } from "@/client/operator/product-settings-editor";
import { authorizedOperatorAddress, OperatorSection } from "../../../section-content";

export default async function ProductsSettingsPage() {
  const address = authorizedOperatorAddress(await readOperatorPageDecision());
  let entry: ProductSettingsEntry | null = null;
  try {
    entry = await readProductSettingsEntryForPage();
  } catch {
    entry = null;
  }
  if (!entry) return <OperatorSection address={address} heading="Products and markets"><ProductSettingsLoadError /></OperatorSection>;
  const catalog = productCatalog();
  const vaultNames = Object.fromEntries(VERIFIED_SAVE_VAULTS.map(({ id, name }) => [id, name]));
  const marketNames = Object.fromEntries(BORROW_MARKETS.map(({ marketId, collateralToken }) => [marketId.toLowerCase(), `${collateralToken.symbol} collateral`]));
  const missingInvestCredentials = (["CDP_API_KEY_ID", "CDP_API_KEY_SECRET"] as const).filter((name) => !process.env[name]?.trim());
  return (
    <OperatorSection address={address} heading="Products and markets">
      <ProductSettingsEditor key={`${address}:${entry.settings.revision}`} initialEntry={entry} catalog={catalog} names={{ vaults: vaultNames, markets: marketNames }} missingInvestCredentials={missingInvestCredentials} operator={address} />
    </OperatorSection>
  );
}
