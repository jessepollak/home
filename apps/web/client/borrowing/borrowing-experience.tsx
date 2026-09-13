"use client";

import Link from "next/link";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MoneyTicker } from "@/components/money-ticker";
import { ArrowLeft } from "lucide-react";
import { useMemo, useState } from "react";
import { useAccountWallet } from "@/client/account/cdp-client";
import { dataOwnerKey as ownerDataKey } from "@/client/account/owner-keys";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { MoneyActionReview } from "@/client/actions/review";
import type {
  OperationResult,
  PreparedMoneyAction,
} from "@/shared/money-actions/types";
import {
  formatHealthFactor,
  formatOracleUsd,
  formatPresentationDate,
  formatPresentationTokenAmount,
  formatWadPercent,
} from "@/shared/formatting";
import { readAnonymousCountryPreference } from "@/config/country-preference";
import { resolvePresentation, type RegionId } from "@/config/regions";
import {
  BORROW_COLLATERAL_TOKEN,
  BORROW_LOAN_TOKEN,
} from "@/shared/borrowing/config";
import type {
  BorrowOperation,
  BorrowPreviewResponse,
} from "@/shared/borrowing/types";
import {
  parseSnapshot,
  type BorrowMarketSnapshot,
} from "@/shared/borrowing/contract";
import {
  ownerQueryKey,
  ownerQueryMeta,
  useHomeQuery,
} from "@/client/query/query-client";

type FetchAccountResource = (
  path: string,
  options?: {
    method?: "GET" | "POST";
    body?: unknown;
    signal?: AbortSignal;
  },
) => Promise<unknown>;

type BorrowExperienceProps = {
  session: VerifiedAccountSession | null;
  fetchAccountResource?: FetchAccountResource;
  prepareMoneyAction?: (
    kind: string,
    params: unknown,
  ) => Promise<PreparedMoneyAction>;
  executeMoneyAction?: (
    action: PreparedMoneyAction,
  ) => Promise<OperationResult>;
  regionId?: RegionId;
};

type SnapshotState =
  | { status: "idle" | "loading"; snapshot: null }
  | { status: "ready"; snapshot: BorrowMarketSnapshot }
  | { status: "error"; snapshot: null };

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "preview-only";
      response: Extract<BorrowPreviewResponse, { status: "preview-only" }>;
    }
  | { status: "prepared"; action: PreparedMoneyAction };

type LimitPresentation = {
  value: string;
  suffix: string;
  secondValue?: string;
  secondSuffix?: string;
};

const BORROW_OPERATION_LABELS: Record<BorrowOperation, string> = {
  "supply-collateral": "Supply cbBTC collateral",
  borrow: "Borrow USDC",
  repay: "Repay USDC (partial)",
  "repay-all": "Repay all USDC debt",
  "withdraw-collateral": "Withdraw cbBTC collateral",
};

/** Not routed today (D4: `/borrow` deleted); retained for a future Borrow shell panel. */
export function AuthenticatedBorrowExperience() {
  const account = useAccountWallet();
  const regionId = usePersistedPresentationRegion();
  return (
    <BorrowExperience
      session={account.status === "verified" ? account.session : null}
      fetchAccountResource={account.fetchAccountResource}
      prepareMoneyAction={account.prepareMoneyAction}
      executeMoneyAction={account.executeMoneyAction}
      regionId={regionId}
    />
  );
}

export function BorrowExperience(props: BorrowExperienceProps) {
  const sessionKey = props.session?.smartAccount
    ? ownerDataKey(props.session)
    : "signed-out";
  return <BorrowExperienceInner key={sessionKey} {...props} />;
}

function BorrowExperienceInner({
  session,
  fetchAccountResource,
  prepareMoneyAction,
  executeMoneyAction,
  regionId = "GLOBAL",
}: BorrowExperienceProps) {
  const owner = session?.smartAccount?.address ?? null;
  const sessionKey = session?.smartAccount ? ownerDataKey(session) : null;
  const dataOwnerKey = sessionKey;
  const snapshotQuery = useHomeQuery({
    queryKey: dataOwnerKey
      ? ownerQueryKey(dataOwnerKey, "borrow")
      : ["unauthenticated", "borrow-disabled"],
    enabled: Boolean(sessionKey && fetchAccountResource && owner),
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
    meta: dataOwnerKey ? ownerQueryMeta(dataOwnerKey, "owner") : undefined,
    queryFn: ({ signal }) => {
      if (!fetchAccountResource) throw new Error("Borrowing is unavailable.");
      return fetchAccountResource("/api/borrow", { signal });
    },
    select: (value) => {
      if (!owner) throw new Error("Borrowing is unavailable.");
      const snapshot = parseSnapshot(value, owner);
      if (!snapshot) throw new Error("Borrowing response is invalid.");
      return snapshot;
    },
  });
  const state: SnapshotState = !sessionKey
    ? { status: "idle", snapshot: null }
    : snapshotQuery.isPending
      ? { status: "loading", snapshot: null }
      : snapshotQuery.isError
        ? { status: "error", snapshot: null }
        : { status: "ready", snapshot: snapshotQuery.data };
  const [operation, setOperation] =
    useState<BorrowOperation>("supply-collateral");
  const [amount, setAmount] = useState("");
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });

  const refresh = () => snapshotQuery.refetch();

  const snapshot = state.status === "ready" ? state.snapshot : null;
  const actionAsset =
    operation === "supply-collateral" || operation === "withdraw-collateral"
      ? BORROW_COLLATERAL_TOKEN
      : BORROW_LOAN_TOKEN;
  const emptyWallet =
    snapshot !== null &&
    BigInt(snapshot.wallet.collateralBalanceRaw) === BigInt("0") &&
    BigInt(snapshot.wallet.loanBalanceRaw) === BigInt("0") &&
    BigInt(snapshot.position.collateralRaw) === BigInt("0") &&
    BigInt(snapshot.position.borrowSharesRaw) === BigInt("0");

  async function submitPreview(event: React.FormEvent) {
    event.preventDefault();
    if (!snapshot || !prepareMoneyAction) return;
    setPreview({ status: "loading" });
    try {
      const action = await prepareMoneyAction(
        operation === "repay-all" ? "repay" : operation,
        {
          operation,
          amount,
          snapshotBlockHash: snapshot.source.blockHash,
        },
      );
      setPreview({ status: "prepared", action });
    } catch (error) {
      setPreview({
        status: "error",
        message: readableResourceError(error),
      });
    }
  }

  const selectedLimit = useMemo<LimitPresentation | null>(() => {
    if (!snapshot) return null;
    switch (operation) {
      case "supply-collateral":
        return {
          value: formatPresentationTokenAmount(
            snapshot.wallet.collateralBalanceRaw,
            8,
            "cbBTC",
            { regionId, useNoBreakSpace: true },
          ),
          suffix: "wallet balance",
        };
      case "borrow":
        return {
          value: formatPresentationTokenAmount(
            snapshot.position.borrowCapacityAssetsRaw,
            6,
            "USDC",
            { cashCurrency: "USD", regionId, useNoBreakSpace: true },
          ),
          suffix: "current capacity",
        };
      case "repay":
        return {
          value: formatPresentationTokenAmount(
            snapshot.position.debtAssetsRaw,
            6,
            "USDC",
            { cashCurrency: "USD", regionId, useNoBreakSpace: true },
          ),
          suffix: "current debt; enter less for an exact partial repayment",
        };
      case "repay-all":
        return {
          value: formatPresentationTokenAmount(
            snapshot.position.debtAssetsRaw,
            6,
            "USDC",
            { cashCurrency: "USD", regionId, useNoBreakSpace: true },
          ),
          suffix: "current debt estimate; maximum cannot exceed",
          secondValue: formatPresentationTokenAmount(
            snapshot.wallet.loanBalanceRaw,
            6,
            "USDC",
            { cashCurrency: "USD", regionId, useNoBreakSpace: true },
          ),
          secondSuffix: "wallet balance",
        };
      case "withdraw-collateral":
        return {
          value: formatPresentationTokenAmount(
            snapshot.position.withdrawableCollateralRaw,
            8,
            "cbBTC",
            { regionId, useNoBreakSpace: true },
          ),
          suffix: "currently withdrawable",
        };
    }
  }, [operation, snapshot, regionId]);

  return (
    <main className="min-h-svh bg-background px-4 py-6 sm:py-10">
      <section
        className="mx-auto w-full max-w-4xl space-y-6"
        aria-labelledby="borrow-title"
      >
        <nav
          className="flex items-center justify-between gap-3"
          aria-label="Borrow navigation"
        >
          <Link
            className={buttonVariants({ variant: "link" })}
            href="/dashboard"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Dashboard
          </Link>
          <span className="text-xs text-muted-foreground">Home · Base</span>
        </nav>
        <header>
          <h1
            className="text-2xl font-semibold tracking-tight"
            id="borrow-title"
          >
            USDC against cbBTC
          </h1>
        </header>

        {!sessionKey ? (
          <BorrowNotice title="Sign in to view this wallet’s position" />
        ) : null}
        {sessionKey && state.status === "loading" ? (
          <BorrowNotice title="Loading current market state" />
        ) : null}
        {sessionKey && state.status === "error" ? (
          <BorrowNotice
            tone="error"
            role="alert"
            title="Borrowing state unavailable"
            action={
              <Button
                type="button"
                variant="secondary"
                size="lg"
                onClick={() => void refresh()}
              >
                Retry
              </Button>
            }
          >
            Refresh to try again.
          </BorrowNotice>
        ) : null}

        {snapshot ? (
          <>
            <p className="text-sm text-muted-foreground">
              <time dateTime={blockTime(snapshot.source.blockTimestamp)}>
                As of{" "}
                {formatTime(
                  blockTime(snapshot.source.blockTimestamp),
                  regionId,
                )}
              </time>
            </p>
            <Card aria-labelledby="position-title">
              <CardHeader>
                <CardTitle>
                  <h2 id="position-title">Wallet and position</h2>
                </CardTitle>
                <CardAction>
                  <Button
                    type="button"
                    variant="secondary"
                    size="lg"
                    onClick={() => void refresh()}
                  >
                    Refresh
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="space-y-4">
                {emptyWallet ? (
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>
                        This wallet has no cbBTC, USDC, or borrow position.
                      </EmptyTitle>
                    </EmptyHeader>
                  </Empty>
                ) : null}
                <ItemGroup>
                  <Metric
                    label="cbBTC wallet"
                    value={formatPresentationTokenAmount(
                      snapshot.wallet.collateralBalanceRaw,
                      8,
                      "cbBTC",
                      { regionId, useNoBreakSpace: true },
                    )}
                    money
                  />
                  <ItemSeparator />
                  <Metric
                    label="USDC wallet"
                    value={formatPresentationTokenAmount(
                      snapshot.wallet.loanBalanceRaw,
                      6,
                      "USDC",
                      { cashCurrency: "USD", regionId, useNoBreakSpace: true },
                    )}
                    money
                  />
                  <ItemSeparator />
                  <Metric
                    label="Collateral supplied"
                    value={formatPresentationTokenAmount(
                      snapshot.position.collateralRaw,
                      8,
                      "cbBTC",
                      { regionId, useNoBreakSpace: true },
                    )}
                    money
                  />
                  <ItemSeparator />
                  <Metric
                    label="Current debt"
                    value={formatPresentationTokenAmount(
                      snapshot.position.debtAssetsRaw,
                      6,
                      "USDC",
                      { cashCurrency: "USD", regionId, useNoBreakSpace: true },
                    )}
                    note="Rounded up from Morpho borrow shares"
                    money
                  />
                  <ItemSeparator />
                  <Metric
                    label="Current borrow capacity"
                    value={formatPresentationTokenAmount(
                      snapshot.position.borrowCapacityAssetsRaw,
                      6,
                      "USDC",
                      { cashCurrency: "USD", regionId, useNoBreakSpace: true },
                    )}
                    note="Lower of collateral limit and indexed liquidity"
                    money
                  />
                  <ItemSeparator />
                  <Metric
                    label="Currently withdrawable"
                    value={formatPresentationTokenAmount(
                      snapshot.position.withdrawableCollateralRaw,
                      8,
                      "cbBTC",
                      { regionId, useNoBreakSpace: true },
                    )}
                    note="At the displayed oracle price"
                    money
                  />
                  <ItemSeparator />
                  <Metric
                    label="Health factor"
                    value={formatHealthFactor(
                      snapshot.position.healthFactorWad,
                      regionId,
                    )}
                    note={healthNote(snapshot.position.healthFactorWad)}
                  />
                  <ItemSeparator />
                  <Metric
                    label="Liquidation price"
                    value={
                      snapshot.position.liquidationPriceRaw
                        ? `${formatOracleUsd(snapshot.position.liquidationPriceRaw, regionId)} / cbBTC`
                        : "No debt"
                    }
                    money={snapshot.position.liquidationPriceRaw !== null}
                  />
                  <ItemSeparator />
                  <Metric
                    label="Oracle price"
                    value={`${formatOracleUsd(snapshot.state.oraclePriceRaw, regionId)} / cbBTC`}
                    money
                  />
                  <ItemSeparator />
                  <Metric
                    label="Variable borrow APR"
                    value={formatWadPercent(
                      snapshot.state.borrowAprWad,
                      regionId,
                    )}
                    note="Current per-second rate annualized; not fixed"
                  />
                  <ItemSeparator />
                  <Metric
                    label="Indexed liquidity"
                    value={formatPresentationTokenAmount(
                      snapshot.state.liquidityAssetsRaw,
                      6,
                      "USDC",
                      { cashCurrency: "USD", regionId, useNoBreakSpace: true },
                    )}
                    money
                  />
                  <ItemSeparator />
                  <Metric
                    label="Market state updated"
                    value={formatTime(
                      blockTime(snapshot.state.lastUpdateTimestamp),
                      regionId,
                    )}
                  />
                </ItemGroup>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>Preview action</h2>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form className="space-y-5" onSubmit={submitPreview}>
                  <FieldGroup>
                    <Field>
                      <FieldLabel id="borrow-operation-label">
                        Action
                      </FieldLabel>
                      <Select
                        value={operation}
                        required
                        onValueChange={(nextOperation) => {
                          if (!nextOperation) return;
                          setOperation(nextOperation as BorrowOperation);
                          setAmount("");
                          setPreview({ status: "idle" });
                        }}
                      >
                        <SelectTrigger
                          className="h-11 w-full"
                          id="borrow-operation"
                          aria-labelledby="borrow-operation-label"
                        >
                          <SelectValue>
                            {(selectedOperation) =>
                              BORROW_OPERATION_LABELS[
                                selectedOperation as BorrowOperation
                              ] ?? selectedOperation
                            }
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="supply-collateral">
                            Supply cbBTC collateral
                          </SelectItem>
                          <SelectItem value="borrow">Borrow USDC</SelectItem>
                          <SelectItem value="repay">
                            Repay USDC (partial)
                          </SelectItem>
                          <SelectItem value="repay-all">
                            Repay all USDC debt
                          </SelectItem>
                          <SelectItem value="withdraw-collateral">
                            Withdraw cbBTC collateral
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="borrow-amount">{`${operation === "repay-all" ? "Maximum debit" : "Amount"} (${actionAsset.symbol})`}</FieldLabel>
                      <Input
                        className="h-11"
                        id="borrow-amount"
                        inputMode="decimal"
                        autoComplete="off"
                        required
                        value={amount}
                        onChange={(event) => {
                          setAmount(event.target.value);
                          setPreview({ status: "idle" });
                        }}
                        placeholder={
                          actionAsset.decimals === 8 ? "0.00000000" : "0.00"
                        }
                      />
                      {selectedLimit ? (
                        <FieldDescription>
                          <MoneyTicker
                            className="min-w-0 align-bottom tabular-nums"
                            value={selectedLimit.value}
                          />{" "}
                          {selectedLimit.suffix}
                          {selectedLimit.secondValue ? (
                            <>
                              {" "}
                              <MoneyTicker
                                className="min-w-0 align-bottom tabular-nums"
                                value={selectedLimit.secondValue}
                              />{" "}
                              {selectedLimit.secondSuffix}
                            </>
                          ) : null}
                        </FieldDescription>
                      ) : null}
                    </Field>
                  </FieldGroup>
                  <Button className="h-11"
                    size="lg"
                    type="submit"
                    disabled={!amount.trim() || preview.status === "loading"}
                    aria-busy={preview.status === "loading"}
                  >
                    {preview.status === "loading"
                      ? "Checking RPC simulation…"
                      : "Review current preview"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </>
        ) : null}

        {preview.status === "error" ? (
          <BorrowNotice tone="error" role="alert" title="Preview unavailable">
            {preview.message}
          </BorrowNotice>
        ) : null}
        {preview.status === "preview-only" ? (
          <Card aria-labelledby="preview-only-title">
            <CardHeader>
              <CardTitle>
                <h2 id="preview-only-title">Read-only preview</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-start justify-between gap-4">
                <strong className="text-sm font-medium">
                  {preview.response.preview.title}
                </strong>
                <span className="text-sm tabular-nums">
                  <MoneyTicker
                    value={formatPresentationTokenAmount(
                      preview.response.preview.amount.amountBaseUnits,
                      preview.response.preview.amount.decimals,
                      preview.response.preview.amount.symbol,
                      { regionId, useNoBreakSpace: true },
                    )}
                  />
                </span>
              </div>
              <ul className="list-disc space-y-1 pl-4">
                {preview.response.preview.warnings.map((warning) => (
                  <li className="text-sm text-muted-foreground" key={warning}>
                    {warning}
                  </li>
                ))}
              </ul>
              <p className="text-sm text-muted-foreground">
                {preview.response.preview.disabledReason}
              </p>
            </CardContent>
          </Card>
        ) : null}
      </section>

      {preview.status === "prepared" ? (
        <MoneyActionReview
          action={preview.action}
          execute={executeMoneyAction}
          onClose={() => setPreview({ status: "idle" })}
          onConfirmed={() => {
            setPreview({ status: "idle" });
            setAmount("");
          }}
        />
      ) : null}
    </main>
  );
}

function Metric({
  label,
  value,
  note,
  money = false,
}: {
  label: string;
  value: string;
  note?: string;
  money?: boolean;
}) {
  return (
    <Item variant="muted" size="sm" render={<li />}>
      <ItemContent className="min-w-0">
        <ItemTitle>{label}</ItemTitle>
        {note ? <ItemDescription>{note}</ItemDescription> : null}
      </ItemContent>
      <ItemActions className="ml-auto max-w-1/2 justify-end text-right text-sm tabular-nums">
        {money ? <MoneyTicker value={value} /> : value}
      </ItemActions>
    </Item>
  );
}

function BorrowNotice({
  action,
  children,
  className,
  role = "status",
  title,
  tone = "neutral",
}: {
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  role?: "status" | "alert";
  title?: React.ReactNode;
  tone?: "neutral" | "error";
}) {
  return (
    <Alert
      className={className}
      role={role}
      variant={tone === "error" ? "destructive" : "default"}
    >
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      {children ? <AlertDescription>{children}</AlertDescription> : null}
      {action ? <AlertAction>{action}</AlertAction> : null}
    </Alert>
  );
}
function healthNote(raw: string | null) {
  if (raw === null) return "No active liquidation threshold";
  const health = BigInt(raw);
  if (health < BigInt("1000000000000000000"))
    return "At or below the indexed liquidation threshold";
  if (health < BigInt("1100000000000000000"))
    return "Very close to liquidation";
  if (health < BigInt("1250000000000000000"))
    return "Limited liquidation buffer";
  return "Above the indexed liquidation threshold";
}

function blockTime(seconds: string) {
  return new Date(Number(seconds) * 1_000).toISOString();
}

function formatTime(value: string, regionId: RegionId) {
  return formatPresentationDate(value, { regionId, style: "date-time-zone" });
}

function usePersistedPresentationRegion(): RegionId {
  const [regionId] = useState<RegionId>(() => {
    if (typeof window === "undefined") return "GLOBAL";
    return resolvePresentation({
      persistedCountry: readAnonymousCountryPreference(
        () => window.localStorage,
      ),
    }).region.id;
  });
  return regionId;
}

function readableResourceError(error: unknown) {
  if (
    error instanceof Error &&
    error.message &&
    error.message !== "Authenticated resource is unavailable."
  )
    return error.message;
  return "The current limit or RPC simulation could not be verified. Refresh and try again.";
}
