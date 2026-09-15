"use client";

import { Popover } from "@base-ui/react/popover";
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
  indicatorVariant?: "solid" | "hollow";
};

export function CoverageStatusPreview({
  status,
  accessibleName,
  heading,
  details,
  indicatorVariant = "solid",
}: CoverageStatusPreviewProps) {
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={accessibleName}
        className={styles.trigger}
        data-indicator={indicatorVariant}
        data-tone={status.toLowerCase()}
        openOnHover
        delay={0}
        render={<button type="button" />}
      >
        {status}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner className={styles.positioner} sideOffset={8}>
          <Popover.Popup className={styles.popup}>
            <Popover.Arrow className={styles.arrow} />
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
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
