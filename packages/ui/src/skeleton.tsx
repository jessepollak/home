import type { CSSProperties, HTMLAttributes } from "react";

export type SkeletonShape = "text" | "rectangle" | "circle";
export type SkeletonDimension = CSSProperties["width"];

export type SkeletonProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  shape?: SkeletonShape;
  width?: SkeletonDimension;
  height?: SkeletonDimension;
  /** Render repeated, evenly spaced placeholders with the same dimensions. */
  rows?: number;
};

function skeletonStyle(
  width: SkeletonDimension | undefined,
  height: SkeletonDimension | undefined,
  style: CSSProperties | undefined,
): CSSProperties {
  return {
    ...style,
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
  };
}

export function Skeleton({
  shape = "rectangle",
  width,
  height,
  rows,
  className,
  style,
  ...props
}: SkeletonProps) {
  const item = (key?: number) => (
    <span
      key={key}
      aria-hidden="true"
      data-shape={shape}
      className="home-ui-skeleton"
      style={skeletonStyle(width, height, style)}
    />
  );

  if (rows !== undefined && rows > 1) {
    return (
      <span
        {...props}
        className={["home-ui-skeleton-group", className].filter(Boolean).join(" ")}
        aria-hidden="true"
        data-rows={rows}
      >
        {Array.from({ length: rows }, (_, index) => item(index))}
      </span>
    );
  }

  return (
    <span
      {...props}
      aria-hidden="true"
      data-shape={shape}
      className={["home-ui-skeleton", className].filter(Boolean).join(" ")}
      style={skeletonStyle(width, height, style)}
    />
  );
}
