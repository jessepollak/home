import type { ReactNode } from "react";
import type { RegionId } from "@/config/regions";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type {
  ActivityPanelDensity,
  FetchActivity,
} from "@/shared/activity/types";

export * from "@/shared/activity/types";

export type ActivityPanelProps = {
  session: VerifiedAccountSession | null;
  fetchActivity: FetchActivity;
  regionId?: RegionId;
  onTransactionHashesChange?: (hashes: string[]) => void;
  leading?: ReactNode;
  suppressEmpty?: boolean;
  density?: ActivityPanelDensity;
  header?: ReactNode | null;
};
