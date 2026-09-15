"use client";

import { PreviewCard } from "@base-ui/react/preview-card";
import { useId, useState } from "react";
import styles from "./coverage-status-preview.module.css";

type TrafficStatus = "Green" | "Yellow" | "Red";

type DetailItem = {
  label: string;
  value: string;
  href?: string;
};

type CoverageStatusPreviewProps = {
  status: TrafficStatus;
  accessibleName: string;
  heading: string;
  details: readonly DetailItem[];
};

export function CoverageStatusPreview({
  status,
  accessibleName,
  heading,
  details,
}: CoverageStatusPreviewProps) {
  const triggerId = useId();
  const [open, setOpen] = useState(false);

  return (
    <PreviewCard.Root open={open} onOpenChange={setOpen} triggerId={triggerId}>
      <PreviewCard.Trigger
        id={triggerId}
        aria-label={accessibleName}
        className={styles.trigger}
        data-tone={status.toLowerCase()}
        delay={0}
        onClick={() => setOpen(true)}
        onPointerUp={(event) => {
          if (event.pointerType === "touch") setOpen(true);
        }}
        render={<button type="button" />}
      >
        {status}
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner className={styles.positioner} sideOffset={8}>
          <PreviewCard.Popup className={styles.popup}>
            <PreviewCard.Arrow className={styles.arrow} />
            <h3 className={styles.heading}>{heading}</h3>
            <dl className={styles.details}>
              {details.map((detail) => (
                <div className={styles.detail} key={detail.label}>
                  <dt>{detail.label}</dt>
                  <dd>
                    {detail.href ? <a href={detail.href}>{detail.value}</a> : detail.value}
                  </dd>
                </div>
              ))}
            </dl>
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}
