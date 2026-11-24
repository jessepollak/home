"use client";

import { createContext, useContext } from "react";
import { BRAND_COPY_FALLBACK_NAME } from "@/shared/operator-branding/theme";

type BrandContextValue = { name: string; logoUrl: string | null; termsUrl: string | null; privacyUrl: string | null };

const BrandContext = createContext<BrandContextValue>({ name: BRAND_COPY_FALLBACK_NAME, logoUrl: null, termsUrl: null, privacyUrl: null });

export function BrandProvider({ children, ...value }: BrandContextValue & { children: React.ReactNode }) {
  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrandName(): string {
  return useContext(BrandContext).name;
}

export function useBrandLogoUrl(): string | null {
  return useContext(BrandContext).logoUrl;
}

export function useBrandLinks(): { termsUrl: string | null; privacyUrl: string | null } {
  const { termsUrl, privacyUrl } = useContext(BrandContext);
  return { termsUrl, privacyUrl };
}
