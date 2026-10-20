"use client";

import { createContext, useContext } from "react";
import { BRAND_COPY_FALLBACK_NAME } from "@/shared/operator-branding/theme";

const BrandNameContext = createContext<string>(BRAND_COPY_FALLBACK_NAME);

export function BrandNameProvider({ name, children }: { name: string; children: React.ReactNode }) {
  return <BrandNameContext.Provider value={name}>{children}</BrandNameContext.Provider>;
}

export function useBrandName(): string {
  return useContext(BrandNameContext);
}
