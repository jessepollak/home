"use client";

import { createContext, useContext, type ReactNode } from "react";
import { resolveProductOffering, type ProductOffering } from "@/shared/operator-settings/products";

const ProductOfferingContext = createContext<ProductOffering>(resolveProductOffering({ kind: "deployment" }));

export function ProductOfferingProvider({ value, children }: { value: ProductOffering; children: ReactNode }) {
  return <ProductOfferingContext.Provider value={value}>{children}</ProductOfferingContext.Provider>;
}

export function useProductOffering(): ProductOffering {
  return useContext(ProductOfferingContext);
}
