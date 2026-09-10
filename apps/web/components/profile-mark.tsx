"use client";

import { useEffect, useState } from "react";
import {
  fetchBasenameProfile,
  profileGlyph,
} from "@/features/account/basename-profile";
import styles from "./profile-mark.module.css";

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
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [basename, setBasename] = useState<string | null>(null);
  const [photoStatus, setPhotoStatus] = useState<"loading" | "ready" | "failed">(
    "ready",
  );

  useEffect(() => {
    if (status !== "ready" || !address) {
      setPhotoUrl(null);
      setBasename(null);
      setPhotoStatus("ready");
      return;
    }

    const controller = new AbortController();
    setPhotoStatus("loading");
    void fetchBasenameProfile(address, fetch, controller.signal).then(
      (profile) => {
        if (controller.signal.aborted) return;
        setBasename(profile?.name ?? null);
        setPhotoUrl(profile?.avatarUrl ?? null);
        setPhotoStatus(profile?.avatarUrl ? "loading" : "ready");
      },
    );
    return () => controller.abort();
  }, [address, status]);

  const glyph = profileGlyph({ basename, ownerKey, address });
  const showShimmer =
    status === "loading" || Boolean(photoUrl && photoStatus === "loading");
  const showPhoto = Boolean(photoUrl && photoStatus !== "failed");

  return (
    <button
      className={styles.hit}
      type="button"
      aria-label="Account"
      disabled={disabled}
      onClick={onClick}
    >
      <span
        className={`${styles.mark} ${showShimmer ? "shimmer" : ""}`}
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
            className={styles.photo}
            src={photoUrl}
            alt=""
            draggable={false}
            hidden={photoStatus !== "ready"}
            onLoad={() => setPhotoStatus("ready")}
            onError={() => setPhotoStatus("failed")}
          />
        ) : null}
        {!showShimmer && !(showPhoto && photoStatus === "ready") ? (
          <span className={styles.glyph}>{glyph}</span>
        ) : null}
      </span>
    </button>
  );
}
