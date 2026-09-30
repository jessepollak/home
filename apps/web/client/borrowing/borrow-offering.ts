import type { ProductOffering } from "@/shared/operator-settings/products";

export function borrowEntryOffered(offering: ProductOffering): boolean {
  return offering.products.borrow === "on" &&
    Object.values(offering.markets).some((mode) => mode === "enabled");
}
