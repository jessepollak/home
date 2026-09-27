"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Item, ItemContent, ItemMedia, ItemSeparator } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { moneySheetLoading } from "@/client/money-modal";
import { presentationRegions, type RegionId } from "@/config/regions";
import type { AddMoneyStep } from "./add-money-dialog";
import type { FundingBinding } from "@/shared/funding/contracts/providers";

export function MethodShimmerRow() {
  return (
    <Item aria-hidden="true" className="h-auto flex-nowrap items-center">
      <ItemMedia variant="avatar">
        <Skeleton className="size-full" data-shimmer="deposit-method" />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <Skeleton className="h-[1.375em] w-24" data-shimmer="deposit-method" />
        <Skeleton className="h-[1.5em] w-44 max-w-full" data-shimmer="deposit-method" />
      </ItemContent>
    </Item>
  );
}

function MethodListSkeleton() {
  return (
    <Card variant="flush">
      <CardContent inset="list">
        <MethodShimmerRow />
        <ItemSeparator className="my-0" />
        <MethodShimmerRow />
      </CardContent>
    </Card>
  );
}

function ReceiveSkeleton() {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="h-5 w-28 overflow-hidden rounded-full">
        <Skeleton className="size-full" data-shimmer="receive-badge" />
      </div>
      <div className="aspect-square w-full max-w-56 overflow-hidden rounded-xl">
        <Skeleton className="size-full" data-shimmer="qr" />
      </div>
      <Skeleton className="h-4 w-36" data-shimmer="address" />
      <div className="grid w-full justify-items-center gap-3 border-t pt-4">
        <Skeleton className="h-4 w-32" data-shimmer="supported-assets" />
        <Skeleton className="h-5 w-40" data-shimmer="supported-assets" />
        <Skeleton className="h-4 w-52 max-w-full" data-shimmer="supported-assets" />
      </div>
    </div>
  );
}

export function addMoneySheetLoading({ step, regionId, selectedBinding, onClose, onClosed }: {
  step: AddMoneyStep;
  regionId: RegionId;
  selectedBinding?: Pick<FundingBinding, "currency"> | null;
  onClose: () => void;
  onClosed?: () => void;
}) {
  const currency = presentationRegions[regionId].currency.code ?? "USD";
  const title = step === "receive"
    ? "Receive"
    : step === "order" || step === "open-order"
      ? `Deposit ${selectedBinding?.currency ?? currency}`
      : "Add money";

  return moneySheetLoading({
    title,
    titleId: "add-money-title",
    closeLabel: "Close add money",
    onCancel: onClose,
    onClosed,
    placeholder: step === "method" ? <MethodListSkeleton /> : step === "receive" ? <ReceiveSkeleton /> : undefined,
  });
}
