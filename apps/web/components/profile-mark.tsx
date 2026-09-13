"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { publicQueryKey, useHomeQuery } from "@/client/query/query-client";
import {
  fetchBasenameProfile,
  profileGlyph,
} from "@/client/account/basename-profile";

export function ProfileMark({
  status,
  ownerKey,
  address,
  disabled = false,
  onClick,
}: {
  status: "loading" | "ready";
  ownerKey?: string | null;
  address?: string | null;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <ProfileMarkButton
      key={`${status}:${address ?? ""}:${ownerKey ?? ""}`}
      status={status}
      ownerKey={ownerKey}
      address={address}
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
  onClick,
}: {
  status: "loading" | "ready";
  ownerKey?: string | null;
  address?: string | null;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const profile = useHomeQuery({
    queryKey: address
      ? publicQueryKey("basename", address.toLowerCase())
      : publicQueryKey("basename", "disabled"),
    enabled: status === "ready" && Boolean(address),
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: ({ signal }) => fetchBasenameProfile(address, fetch, signal),
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
      className="size-11 shrink-0"
      variant="ghost"
      size="icon-lg"
      aria-label="Account"
      disabled={disabled}
      onClick={onClick}
    >
      <span
        className={`relative isolate grid size-8 place-items-center overflow-hidden rounded-full bg-muted text-sm font-semibold text-foreground ${showShimmer ? "animate-pulse" : ""}`}
        data-profile={
          showShimmer ? "shimmer" : showPhoto && photoStatus === "ready" ? "photo" : "glyph"
        }
        data-shimmer={showShimmer ? "profile" : undefined}
        aria-hidden="true"
      >
        {showPhoto && photoUrl ? (
          // Remote Basename photos are not in the Next image allowlist.
          // eslint-disable-next-line @next/next/no-img-element
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
