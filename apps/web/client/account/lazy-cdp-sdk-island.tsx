"use client";

import {
  Component,
  lazy,
  useEffect,
  type ComponentType,
  type ReactNode,
} from "react";
import type { CdpSdkBoundary } from "./cdp-sdk-provider";

type CdpSdkIslandProps = {
  projectId: string;
  onBoundary: (boundary: CdpSdkBoundary) => void;
  onError: () => void;
};

type CdpSdkModule = {
  CdpSdkIsland: ComponentType<CdpSdkIslandProps>;
};

export function createLazyCdpSdkIsland(
  load: () => Promise<CdpSdkModule> = () => import("./cdp-sdk-provider"),
) {
  return lazy(() => load().then((module) => ({ default: module.CdpSdkIsland })));
}

export class LazyCdpErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function LazyCdpFailure({ onError }: { onError: () => void }) {
  useEffect(onError, [onError]);
  return null;
}
