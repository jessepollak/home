import type { ComponentType, ReactNode } from "react";
import { ContourBackdrop } from "./contour";
import { DepthBackdrop } from "./depth";
import { GrainBackdrop } from "./grain";

export type BackdropVariant = "none" | "grain" | "depth" | "contour";
export type BackdropRegion = "hero" | "customers" | "team" | "demo";

export type BackdropProps = { region: BackdropRegion; children: ReactNode };

const variants: Record<Exclude<BackdropVariant, "none">, ComponentType<BackdropProps>> = {
  grain: GrainBackdrop,
  depth: DepthBackdrop,
  contour: ContourBackdrop,
};

export function Backdrop({ variant, region, children }: BackdropProps & { variant: BackdropVariant }) {
  if (variant === "none") return children;
  const Variant = variants[variant];
  return <Variant region={region}>{children}</Variant>;
}
