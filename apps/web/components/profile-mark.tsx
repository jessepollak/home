"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { profileGlyph } from "@/client/account/basename-profile";
import { useBasenameProfile } from "@/client/account/use-basename-profile";
export type SupportSummaryStatus = "checking" | "unavailable" | "ready";

export function supportUnreadLabel(label: string, unreadCount: number | null, status?: SupportSummaryStatus): string {
  const count = unreadCount !== null && unreadCount > 0 ? `${label}, ${unreadCount} unread support ${unreadCount === 1 ? "message" : "messages"}` : label;
  if (status === "unavailable") return `${count}, couldn't check support messages${unreadCount !== null && unreadCount > 0 ? ", unread count may be out of date" : ""}`;
  if (status === "checking") return `${count}, checking support messages`;
  return count;
}

export function SupportUnreadDot({ unreadCount, status }: { unreadCount: number | null; status?: SupportSummaryStatus }) {
  if (status === "unavailable") return <span className="absolute end-1 top-1 size-2 rounded-full bg-warning" aria-hidden="true" data-support-status="unavailable" />;
  if (status === "checking") return <span className="absolute end-1 top-1 size-2 rounded-full bg-muted-foreground" aria-hidden="true" data-support-status="checking" />;
  return unreadCount !== null && unreadCount > 0 ? <span className="absolute end-1 top-1 size-2 rounded-full bg-destructive" aria-hidden="true" data-support-unread="" /> : null;
}

export function ProfileMark({
  status,
  ownerKey,
  address,
  supportUnreadCount = null,
  supportSummaryStatus,
  disabled = false,
  onClick,
}: {
  status: "loading" | "ready";
  ownerKey?: string | null;
  address?: string | null;
  disabled?: boolean;
  onClick?: (button: HTMLButtonElement) => void;
  supportUnreadCount?: number | null;
  supportSummaryStatus?: SupportSummaryStatus;
}) {
  return (
    <ProfileMarkButton
      key={`${status}:${address ?? ""}:${ownerKey ?? ""}`}
      status={status}
      ownerKey={ownerKey}
      address={address}
      supportUnreadCount={supportUnreadCount}
      supportSummaryStatus={supportSummaryStatus}
      disabled={disabled}
      onClick={onClick}
    />
  );
}

function ProfileMarkButton({
  status,
  ownerKey,
  address,
  disabled = false,
  supportUnreadCount = null,
  supportSummaryStatus,
  onClick,
}: {
  status: "loading" | "ready";
  ownerKey?: string | null;
  address?: string | null;
  disabled?: boolean;
  supportUnreadCount?: number | null;
  supportSummaryStatus?: SupportSummaryStatus;
  onClick?: (button: HTMLButtonElement) => void;
}) {
  const profile = useBasenameProfile({
    ownerKey,
    address,
    enabled: status === "ready",
  });
  const basename = profile.data?.name ?? null;
  const photoUrl = profile.data?.avatarUrl ?? null;
  const [photoState, setPhotoState] = useState<{
    url: string | null;
    status: "ready" | "failed";
  }>({ url: null, status: "ready" });
  const photoStatus = photoState.url === photoUrl
    ? photoState.status
    : photoUrl ? "loading" : "ready";

  const glyph = profileGlyph({ basename, ownerKey, address });
  const showShimmer = status === "loading" ||
    (status === "ready" && Boolean(address) && profile.isPending) ||
    Boolean(photoUrl && photoStatus === "loading");
  const showPhoto = Boolean(photoUrl && photoStatus !== "failed");

  return (
    <Button
      className="relative size-11 shrink-0"
      variant="ghost"
      size="icon-lg"
      aria-label={supportUnreadLabel("Account", supportUnreadCount, supportSummaryStatus)}
      disabled={disabled}
      onClick={(event) => onClick?.(event.currentTarget)}
    >
      <SupportUnreadDot unreadCount={supportUnreadCount} status={supportSummaryStatus} />
      <span
        className={`relative isolate grid size-8 place-items-center overflow-hidden rounded-full bg-muted text-sm font-semibold text-foreground ${showShimmer ? "animate-pulse" : ""}`}
        data-profile={
          showShimmer ? "shimmer" : showPhoto && photoStatus === "ready" ? "photo" : "glyph"
        }
        data-shimmer={showShimmer ? "profile" : undefined}
        aria-hidden="true"
      >
        {showPhoto && photoUrl ? (
          // oxlint-disable-next-line nextjs/no-img-element -- Profile avatar URLs are remote runtime data, so next/image cannot statically optimize them.
          <img
            className="col-start-1 row-start-1 size-full object-cover"
            src={photoUrl}
            alt=""
            draggable={false}
            hidden={photoStatus !== "ready"}
            onLoad={() => setPhotoState({ url: photoUrl, status: "ready" })}
            onError={() => setPhotoState({ url: photoUrl, status: "failed" })}
          />
        ) : null}
        {!showShimmer && !(showPhoto && photoStatus === "ready") ? (
          <span className="col-start-1 row-start-1 grid size-full place-items-center bg-muted lowercase text-foreground">{glyph}</span>
        ) : null}
      </span>
    </Button>
  );
}
