"use client";

import { Fragment, type ReactNode } from "react";
import { useOptionalAccountWallet } from "./cdp-client";
import { uiBoundary } from "./owner-keys";

export function OwnerBoundary({ children }: { children: ReactNode }) {
  const wallet = useOptionalAccountWallet();
  return <Fragment key={wallet ? uiBoundary(wallet) ?? "no-owner" : "no-owner"}>{children}</Fragment>;
}
