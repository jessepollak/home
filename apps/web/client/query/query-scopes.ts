import { queryScopes } from "./scopes";

export { queryScopes } from "./scopes";

export type QueryScope = keyof typeof queryScopes;
export type OwnerQueryScope = { [Scope in QueryScope]: typeof queryScopes[Scope]["audience"] extends "owner" ? Scope : never }[QueryScope];
export type PublicQueryScope = Exclude<QueryScope, OwnerQueryScope>;

export const tradeAvailabilityScope = "trade-availability" satisfies OwnerQueryScope;
export const activityWindowScope = "activity-window" satisfies OwnerQueryScope;
export const networkFeePolicyScope = "network-fee-policy" satisfies OwnerQueryScope;
